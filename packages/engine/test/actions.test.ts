import { chmod, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  claudeArgs,
  detectActions,
  digestRun,
  git,
  RunManager,
  runShell,
  TraceStore,
  whyItCouldNotStart,
  withPackageManager,
} from "../src/index";
import { tempDir, workspace } from "./helpers";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const stores: TraceStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  delete process.env.FAKE_CLAUDE_ARGS_FILE;
});

async function repo(files: Record<string, string>) {
  const dir = await workspace(files);
  await git(dir, ["init", "-q", "-b", "main"]);
  await git(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
  await git(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  await git(dir, ["config", "user.email", "t@t"]);
  await git(dir, ["config", "user.name", "t"]);
  return dir;
}

async function manager(dir: string, actions?: Parameters<TraceStore["setProjectActions"]>[1]) {
  const store = new TraceStore(":memory:");
  stores.push(store);
  const m = new RunManager({ store, worktreesRoot: await tempDir(), claudePath: FAKE });
  const project = store.addProject({ name: "p", path: dir });
  if (actions) store.setProjectActions(project.id, actions);
  return { store, m, project };
}

const MATH = { "math.js": "export const add = (a, b) => a - b;\n" };
// Passes once the fake agent has "fixed" math.js.
const FIXED_CHECK = `grep -q "fixed by fake claude" math.js`;

describe("detectActions", () => {
  test("reads a pnpm project's install, test, typecheck and dev server", async () => {
    const dir = await workspace({
      "pnpm-lock.yaml": "",
      "package.json": JSON.stringify({
        scripts: { test: "vitest", typecheck: "tsc", dev: "vite" },
      }),
    });
    expect(await detectActions(dir)).toEqual({
      setup: "pnpm install",
      checks: ["pnpm test", "pnpm typecheck"],
      dev: { command: "pnpm dev", url: "http://localhost:5173" },
      sendBackFailures: true,
    });
  });

  test("skips npm's placeholder test script, and knows Go", async () => {
    const npm = await workspace({
      "package.json": JSON.stringify({
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
    });
    expect((await detectActions(npm)).checks).toEqual([]);
    expect((await detectActions(await workspace({ "go.mod": "module x" }))).checks).toEqual([
      "go test ./...",
    ]);
  });
});

describe("setup problems", () => {
  test("package.json's packageManager wins over lockfiles", async () => {
    const dir = await workspace({
      "package.json": JSON.stringify({
        packageManager: "yarn@1.22.22",
        scripts: { lint: "eslint ." },
      }),
      "pnpm-lock.yaml": "",
      "yarn.lock": "",
    });
    expect(await detectActions(dir)).toMatchObject({
      setup: "yarn install",
      checks: ["yarn lint"],
    });
  });

  test("swaps package managers and spots tools that couldn't start", () => {
    expect(withPackageManager("pnpm lint", "yarn")).toBe("yarn lint");
    expect(withPackageManager("yarn lint", "npm")).toBe("npm run lint");
    expect(withPackageManager("pnpm test", "npm")).toBe("npm test");
    expect(withPackageManager("make test", "npm")).toBe("make test");
    expect(
      whyItCouldNotStart(
        "warn: This version of pnpm requires at least Node.js v22.13\nThe current version of Node.js is v20.18.0",
      ),
    ).toBe("it needs Node 22.13 or newer");
    expect(
      whyItCouldNotStart(
        "Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite",
      ),
    ).toMatch(/newer version of Node/);
    expect(whyItCouldNotStart("/bin/sh: deno: command not found")).toBe("deno isn't installed");
    expect(whyItCouldNotStart("1 test failed")).toBeNull();
  });
});

describe("runShell", () => {
  test("captures output and exit status", async () => {
    const r = await runShell("echo hi && exit 3", await tempDir());
    expect(r).toMatchObject({ ok: false, exitCode: 3, output: "hi" });
  });
});

describe("composer settings", () => {
  test("model, effort and full access reach Claude Code", () => {
    const args = claudeArgs({ task: "x", model: "opus", effort: "high", access: "full" });
    expect(args[args.indexOf("--model") + 1]).toBe("opus");
    expect(args[args.indexOf("--effort") + 1]).toBe("high");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(
      claudeArgs({ task: "x" })[claudeArgs({ task: "x" }).indexOf("--permission-mode") + 1],
    ).toBe("acceptEdits");
  });
});

describe("runs with actions", () => {
  test("setup runs first, checks decide the outcome", async () => {
    const dir = await repo(MATH);
    const { store, m, project } = await manager(dir, {
      setup: "echo ready > .setup-ran",
      checks: [FIXED_CHECK],
      dev: null,
      sendBackFailures: true,
    });
    const runId = await m.start(project.id, "Fix add()", { model: "opus" });
    await m.settled(runId);
    const run = store.getRun(runId);
    const names = store
      .events(runId)
      .flatMap((e) => (e.event.type === "tool.result" ? [e.event.name] : []));
    expect(names[0]).toBe("setup");
    expect(names.at(-1)).toBe("checks");
    expect(digestRun(store.events(runId)).tests).toMatchObject({ passed: true });
    expect(run?.settings).toMatchObject({ model: "opus", baseBranch: "main" });
    expect(await readFile(path.join(run?.worktree?.path ?? "", ".setup-ran"), "utf8")).toContain(
      "ready",
    );
  });

  test("failing checks go back to the agent, at most twice", async () => {
    const dir = await repo(MATH);
    const { store, m, project } = await manager(dir, {
      setup: null,
      checks: ["echo '1 test failed' && exit 1"],
      dev: null,
      sendBackFailures: true,
    });
    const runId = await m.start(project.id, "Fix add()");
    await m.settled(runId);
    const turns = store.events(runId).filter((e) => e.event.type === "agent.start");
    expect(turns).toHaveLength(3);
    const second = turns[1]?.event;
    expect(second?.type === "agent.start" && second.task).toMatch(
      /checks failed[\s\S]*1 test failed/,
    );
    expect(digestRun(store.events(runId)).tests).toMatchObject({ passed: false });
  });

  test("a check that can't start is fixed with the project's package manager, and saved", async () => {
    // A "yarn" that's too new for this Node, like pnpm 11 on Node 20.
    const bin = await tempDir();
    await writeFile(
      path.join(bin, "yarn"),
      "#!/bin/sh\necho 'This version of yarn requires at least Node.js v99'\nexit 1\n",
    );
    await chmod(path.join(bin, "yarn"), 0o755);
    const oldPath = process.env.PATH;
    process.env.PATH = `${bin}:${oldPath ?? ""}`;
    try {
      const dir = await repo({
        ...MATH,
        "package.json": JSON.stringify({
          packageManager: "npm@10.0.0",
          scripts: { lint: "echo linted" },
        }),
        "node_modules/.keep": "",
      });
      const { store, m, project } = await manager(dir, {
        setup: null,
        checks: ["yarn lint"],
        dev: null,
        sendBackFailures: true,
      });
      const runId = await m.start(project.id, "Fix add()");
      await m.settled(runId);
      expect(digestRun(store.events(runId)).tests).toMatchObject({ passed: true });
      expect(store.getProject(project.id)?.actions?.checks).toEqual(["npm run lint"]);
      const checks = store
        .events(runId)
        .find((e) => e.event.type === "tool.result" && e.event.name === "checks");
      expect(checks?.event.type === "tool.result" && checks.event.output).toMatch(
        /Fixed the setup on its own: used npm/,
      );
    } finally {
      process.env.PATH = oldPath;
    }
  });

  test("a check that can't start, and can't be fixed, isn't sent to the agent", async () => {
    const dir = await repo(MATH);
    const { store, m, project } = await manager(dir, {
      setup: null,
      checks: ["definitely-not-a-tool lint"],
      dev: null,
      sendBackFailures: true,
    });
    const runId = await m.start(project.id, "Fix add()");
    await m.settled(runId);
    expect(store.events(runId).filter((e) => e.event.type === "agent.start")).toHaveLength(1);
    expect(digestRun(store.events(runId)).tests).toMatchObject({
      passed: false,
      cantStart: "definitely-not-a-tool isn't installed",
    });
  });

  test("a run in the current checkout works in place and can't be discarded", async () => {
    const dir = await repo(MATH);
    const { store, m, project } = await manager(dir, {
      setup: "touch .nope",
      checks: [],
      dev: null,
      sendBackFailures: false,
    });
    const runId = await m.start(project.id, "Fix add()", { workspace: "checkout" });
    await m.settled(runId);
    const run = store.getRun(runId);
    expect(run?.worktree?.path).toBe(dir);
    expect(await readFile(path.join(dir, "math.js"), "utf8")).toContain("fixed by fake claude");
    // setup only runs on new branches
    await expect(readFile(path.join(dir, ".nope"))).rejects.toThrow();
    await expect(m.discard(runId)).rejects.toThrow(/own checkout/);
  });

  test("merge commits the run's work and merges it into the branch it came from", async () => {
    const dir = await repo(MATH);
    const { m, project } = await manager(dir, {
      setup: null,
      checks: [],
      dev: null,
      sendBackFailures: false,
    });
    const runId = await m.start(project.id, "fix add() in math.js");
    await m.settled(runId);
    expect((await m.merge(runId)).message).toBe("Merged into main");
    expect(await readFile(path.join(dir, "math.js"), "utf8")).toContain("fixed by fake claude");
    expect(await git(dir, ["log", "--format=%s", "-3"])).toContain("Fix add() in math.js");
  });

  test("resume continues the same Claude Code session", async () => {
    const dir = await repo(MATH);
    const { m, project } = await manager(dir, {
      setup: null,
      checks: [],
      dev: null,
      sendBackFailures: false,
    });
    const runId = await m.start(project.id, "Fix add()");
    await m.settled(runId);
    const argsFile = path.join(await tempDir(), "args.json");
    process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
    await m.resume(runId);
    await m.settled(runId);
    const args = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    expect(args).toContain("--resume");
    expect(args[1]).toMatch(/Continue where you left off/);
  });

  test("removing a project keeps its folder and saves unsaved agent work to the branch", async () => {
    const dir = await repo(MATH);
    const { store, m, project } = await manager(dir, {
      setup: null,
      checks: [],
      dev: null,
      sendBackFailures: false,
    });
    const runId = await m.start(project.id, "Fix add()");
    await m.settled(runId);
    const branch = store.getRun(runId)?.worktree?.branch ?? "";
    const wtPath = store.getRun(runId)?.worktree?.path ?? "";
    await m.removeProject(project.id);
    expect(store.getProject(project.id)).toBeUndefined();
    expect(store.getRun(runId)).toBeUndefined();
    // The user's project is untouched; the run's folder is gone; its work is on the branch.
    expect(await readFile(path.join(dir, "math.js"), "utf8")).not.toContain("fixed by fake claude");
    await expect(readFile(path.join(wtPath, "math.js"))).rejects.toThrow();
    expect(await git(dir, ["show", `${branch}:math.js`])).toContain("fixed by fake claude");
  });
});
