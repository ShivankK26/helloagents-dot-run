import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { git, reply, RunManager, ScriptedModel, TraceStore } from "../src/index";
import { tempDir, workspace } from "./helpers";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const stores: TraceStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  delete process.env.FAKE_CLAUDE_MODE;
});

async function setup(
  files: Record<string, string> = { "math.js": "export const add = (a, b) => a - b;\n" },
  commit = true,
) {
  const repo = await workspace(files);
  await git(repo, ["init", "-q", "-b", "main"]);
  if (commit) {
    await git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
    await git(repo, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  }
  const store = new TraceStore(":memory:");
  stores.push(store);
  const changes: string[] = [];
  const manager = new RunManager({
    store,
    worktreesRoot: await tempDir(),
    claudePath: FAKE,
    onChange: (id) => changes.push(id),
  });
  const project = store.addProject({ name: "api", path: repo });
  return { repo, store, manager, project, changes };
}

describe("RunManager", () => {
  test("runs Claude Code on its own branch and records everything", async () => {
    const { store, manager, project, changes } = await setup();
    const runId = await manager.start(project.id, "Fix add()");
    expect(manager.isActive(runId)).toBe(true);
    await manager.settled(runId);

    const run = store.getRun(runId);
    expect(run).toMatchObject({
      status: "done",
      projectId: project.id,
      agent: "claude-code",
      summary: "Fixed add() and the tests pass.",
    });
    expect(run?.worktree?.branch).toMatch(/^helloagents\/[0-9a-f]{6}-fix-add/);
    expect(store.events(runId).map((e) => e.event.type)).toContain("agent.end");
    expect(store.listProjectRuns(project.id).map((r) => r.id)).toEqual([runId]);
    expect(manager.isActive(runId)).toBe(false);
    expect(new Set(changes)).toEqual(new Set([runId]));
    expect(await manager.diff(runId)).toContain("+// fixed by fake claude");
  });

  test("can be cancelled mid-run", async () => {
    process.env.FAKE_CLAUDE_MODE = "slow";
    const { store, manager, project } = await setup();
    const runId = await manager.start(project.id, "Fix add()");
    await new Promise((r) => setTimeout(r, 300));
    manager.cancel(runId);
    await manager.settled(runId);
    expect(store.getRun(runId)?.status).toBe("cancelled");
  });

  test("explains a repo with no commits instead of failing silently", async () => {
    const { store, manager, project } = await setup({ "a.js": "" }, false);
    const runId = await manager.start(project.id, "Do something");
    expect(store.getRun(runId)).toMatchObject({
      status: "error",
      error: expect.stringMatching(/no commits yet/),
    });
  });

  test("Codex projects get a clear not-yet-supported message", async () => {
    const { store, manager, project } = await setup();
    store.updateProjectAgents(project.id, { workerAgent: "codex", plannerAgent: "codex" });
    const runId = await manager.start(project.id, "Fix add()");
    await manager.settled(runId);
    expect(store.getRun(runId)).toMatchObject({
      status: "error",
      summary: "Codex isn't supported yet.",
    });
  });

  test("the built-in harness runs too, given a model", async () => {
    const { store, project, repo } = await setup();
    store.updateProjectAgents(project.id, { workerAgent: "harness", plannerAgent: "harness" });
    const manager = new RunManager({
      store,
      worktreesRoot: await tempDir(),
      createModel: () =>
        new ScriptedModel([
          reply({ tools: [{ name: "finish", input: { summary: "Nothing to do." } }] }),
        ]),
    });
    const runId = await manager.start(project.id, "Check add()");
    await manager.settled(runId);
    expect(store.getRun(runId)).toMatchObject({ status: "done", summary: "Nothing to do." });
    expect(repo).toBeTruthy();
  });

  test("discard removes the branch but keeps the history", async () => {
    const { store, manager, project, repo } = await setup();
    const runId = await manager.start(project.id, "Fix add()");
    await manager.settled(runId);
    await manager.discard(runId);
    expect(await git(repo, ["branch", "--list", "helloagents/*"])).toBe("");
    expect(store.getRun(runId)?.status).toBe("done");
  });

  test("projects are unique by path", async () => {
    const { store, project, repo } = await setup();
    expect(store.addProject({ name: "again", path: repo }).id).toBe(project.id);
    expect(store.listProjects()).toHaveLength(1);
  });
});
