import { execFile, spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
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
    // package.json's "packageManager" says which one the project uses; lockfiles are a guess.
    const pm =
      (await declaredPackageManager(repo)) ??
      ((await exists(path.join(repo, "pnpm-lock.yaml")))
        ? "pnpm"
        : (await exists(path.join(repo, "bun.lockb"))) ||
            (await exists(path.join(repo, "bun.lock")))
          ? "bun"
          : (await exists(path.join(repo, "yarn.lock")))
            ? "yarn"
            : "npm");
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

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";
const PACKAGE_MANAGERS: readonly PackageManager[] = ["npm", "pnpm", "yarn", "bun"];

/** The package manager package.json asks for ("packageManager": "yarn@1.22.22"), if any. */
export async function declaredPackageManager(repo: string): Promise<PackageManager | null> {
  try {
    const pkg = JSON.parse(await readFile(path.join(repo, "package.json"), "utf8")) as {
      packageManager?: string;
    };
    const name = pkg.packageManager?.split("@")[0] as PackageManager | undefined;
    return name && PACKAGE_MANAGERS.includes(name) ? name : null;
  } catch {
    return null;
  }
}

/** The same command with another package manager: "pnpm lint" → "yarn lint". */
export function withPackageManager(command: string, pm: PackageManager): string {
  const m = /^(npm|pnpm|yarn|bun)\s+(.*)$/.exec(command.trim());
  if (!m?.[2] || m[1] === pm) return command;
  const rest = m[2].replace(/^run\s+/, "");
  if (pm === "npm")
    return rest === "test" || rest === "install" ? `npm ${rest}` : `npm run ${rest}`;
  return `${pm} ${rest}`;
}

/**
 * When a command's output shows the tool itself couldn't start (too old a Node,
 * not installed), says why in plain words. That isn't a problem with the code.
 */
export function whyItCouldNotStart(output: string): string | null {
  const needs = /requires at least Node\.?js v?(\d+(?:\.\d+)*)/i.exec(output);
  const have = /You are using Node\.?js v?(\d+(?:\.\d+)*)/i.exec(output);
  if (needs) return `it needs Node ${needs[1]} or newer${have ? `, and found ${have[1]}` : ""}`;
  if (
    /ERR_UNKNOWN_BUILTIN_MODULE|SyntaxError: Unexpected token '\?\?='|engine "node" is incompatible|Unsupported engine/i.test(
      output,
    )
  )
    return "it needs a newer version of Node";
  const missing = /(?:^|\n)(?:\/bin\/sh: )?(?:line \d+: )?([\w.-]+): (?:command )?not found/.exec(
    output,
  );
  if (missing) return `${missing[1]} isn't installed`;
  return null;
}

/** Node.js installs on this Mac (nvm, fnm, Volta, Homebrew), newest first. */
export async function installedNodes(): Promise<Array<{ version: string; bin: string }>> {
  const home = homedir();
  const found: Array<{ version: string; bin: string }> = [];
  const scan = async (root: string, bin: (dir: string) => string) => {
    let dirs: string[];
    try {
      dirs = await readdir(root);
    } catch {
      return;
    }
    for (const d of dirs) {
      const dir = bin(path.join(root, d));
      if (/^v?\d+\.\d+\.\d+$/.test(d) && (await exists(path.join(dir, "node"))))
        found.push({ version: d.replace(/^v/, ""), bin: dir });
    }
  };
  await scan(path.join(home, ".nvm/versions/node"), (d) => path.join(d, "bin"));
  await scan(path.join(home, ".local/share/fnm/node-versions"), (d) =>
    path.join(d, "installation/bin"),
  );
  await scan(path.join(home, ".volta/tools/image/node"), (d) => path.join(d, "bin"));
  await scan("/opt/homebrew/Cellar/node", (d) => path.join(d, "bin"));
  await scan("/usr/local/Cellar/node", (d) => path.join(d, "bin"));
  const key = (v: string) =>
    v
      .split(".")
      .map((n) => n.padStart(5, "0"))
      .join(".");
  return found.sort((a, b) => key(b.version).localeCompare(key(a.version)));
}

/** The environment for a project's commands, with its chosen Node first on PATH. */
export function commandEnv(nodeBin?: string | null): NodeJS.ProcessEnv {
  if (!nodeBin) return process.env;
  return { ...process.env, PATH: `${nodeBin}${path.delimiter}${process.env.PATH ?? ""}` };
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
  opts: { signal?: AbortSignal; timeoutMs?: number; nodeBin?: string | null } = {},
): Promise<CommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    let output = "";
    let settled = false;
    const child = spawn("/bin/sh", ["-c", command], {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...commandEnv(opts.nodeBin), CI: "1", FORCE_COLOR: "0" },
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
export function startBackground(
  command: string,
  cwd: string,
  nodeBin?: string | null,
): ChildProcess {
  const child = spawn("/bin/sh", ["-c", command], {
    cwd,
    stdio: "ignore",
    detached: true,
    env: { ...commandEnv(nodeBin), FORCE_COLOR: "0", BROWSER: "none" },
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
