import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ProjectActions } from "../types";

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

/**
 * Works out a project's setup, checks and dev server from its own files, so a
 * run can be judged by the project's tests instead of the agent's word.
 */
export async function detectActions(repo: string): Promise<ProjectActions> {
  const actions: ProjectActions = { setup: null, checks: [], dev: null, sendBackFailures: true };
  const pkgFile = path.join(repo, "package.json");
  if (await exists(pkgFile)) {
    const pm = (await exists(path.join(repo, "pnpm-lock.yaml")))
      ? "pnpm"
      : (await exists(path.join(repo, "bun.lockb"))) || (await exists(path.join(repo, "bun.lock")))
        ? "bun"
        : (await exists(path.join(repo, "yarn.lock")))
          ? "yarn"
          : "npm";
    let scripts: Record<string, string> = {};
    try {
      scripts =
        (JSON.parse(await readFile(pkgFile, "utf8")) as { scripts?: Record<string, string> })
          .scripts ?? {};
    } catch {
      // unreadable package.json: fall back to install only
    }
    const run = (name: string) =>
      pm === "npm" ? (name === "test" ? "npm test" : `npm run ${name}`) : `${pm} ${name}`;
    actions.setup = `${pm} install`;
    // npm's placeholder test script always fails; don't treat it as a check.
    if (scripts.test && !/no test specified/.test(scripts.test)) actions.checks.push(run("test"));
    for (const name of ["typecheck", "lint"]) if (scripts[name]) actions.checks.push(run(name));
    if (scripts.dev) actions.dev = { command: run("dev"), url: guessDevUrl(scripts.dev) };
    return actions;
  }
  if (await exists(path.join(repo, "go.mod"))) {
    actions.checks.push("go test ./...");
    return actions;
  }
  if (await exists(path.join(repo, "Cargo.toml"))) {
    actions.checks.push("cargo test");
    return actions;
  }
  if (
    (await exists(path.join(repo, "pyproject.toml"))) ||
    (await exists(path.join(repo, "pytest.ini")))
  ) {
    if (await exists(path.join(repo, "uv.lock"))) actions.setup = "uv sync";
    actions.checks.push(actions.setup ? "uv run pytest" : "pytest");
    return actions;
  }
  if (await exists(path.join(repo, "Makefile"))) {
    const make = await readFile(path.join(repo, "Makefile"), "utf8").catch(() => "");
    if (/^test:/m.test(make)) actions.checks.push("make test");
  }
  return actions;
}

function guessDevUrl(script: string): string {
  const port = /--port[ =](\d+)|-p (\d+)/.exec(script);
  const n = port?.[1] ?? port?.[2];
  if (n) return `http://localhost:${n}`;
  if (/\bvite\b/.test(script)) return "http://localhost:5173";
  if (/\bastro\b/.test(script)) return "http://localhost:4321";
  return "http://localhost:3000";
}

export interface CommandResult {
  ok: boolean;
  /** stdout and stderr together, trimmed to the last 60 KB. */
  output: string;
  durationMs: number;
  exitCode: number | null;
}

const MAX_OUTPUT = 60_000;

/** Runs a shell command in a folder and collects its output. */
export function runShell(
  command: string,
  cwd: string,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: "1", FORCE_COLOR: "0" },
    });
    const take = (chunk: Buffer) => {
      output = (output + chunk.toString("utf8")).slice(-MAX_OUTPUT);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(
      () => {
        output += `\n(stopped after ${Math.round((opts.timeoutMs ?? 0) / 1000)}s)`;
        child.kill("SIGTERM");
      },
      opts.timeoutMs ?? 15 * 60_000,
    );
    const onAbort = () => child.kill("SIGTERM");
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    const finish = (exitCode: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({
        ok: exitCode === 0,
        output: output.trim(),
        durationMs: Date.now() - started,
        exitCode,
      });
    };
    child.on("error", (e) => {
      output += `\n${e.message}`;
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });
}

/** Starts a long-running command (a dev server) in its own process group. */
export function startBackground(command: string, cwd: string): ChildProcess {
  const child = spawn("/bin/sh", ["-c", command], {
    cwd,
    stdio: "ignore",
    detached: true,
    env: { ...process.env, FORCE_COLOR: "0", BROWSER: "none" },
  });
  child.unref();
  return child;
}

/** Stops a background command and everything it started. */
export function stopBackground(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

/** Opens a pull request with the GitHub CLI. Returns its URL. */
export async function openPullRequest(
  dir: string,
  opts: { branch: string; base: string; title: string; body: string },
): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "gh",
      [
        "pr",
        "create",
        "--head",
        opts.branch,
        "--base",
        opts.base,
        "--title",
        opts.title,
        "--body",
        opts.body,
      ],
      { cwd: dir },
      (error, stdout, stderr) => {
        if (error) {
          const msg = (stderr || error.message).trim();
          reject(
            new Error(
              /ENOENT/.test(error.message)
                ? "The GitHub CLI (gh) isn't installed. Install it with `brew install gh`, then run `gh auth login`."
                : msg,
            ),
          );
        } else resolve(stdout.trim().split("\n").at(-1) ?? "");
      },
    );
  });
}
