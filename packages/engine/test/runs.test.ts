import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import { git, reply, RunManager, ScriptedModel, TraceStore } from "../src/index";
import { tempDir, workspace } from "./helpers";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
const stores: TraceStore[] = [];
afterEach(() => {
  stores.splice(0).forEach((s) => s.close());
  delete process.env.FAKE_CLAUDE_MODE;
  delete process.env.FAKE_CLAUDE_ARGS_FILE;
  delete process.env.FAKE_CLAUDE_ANSWER_FILE;
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

  test("a follow-up continues the same run, branch and Claude Code session", async () => {
    const { store, manager, project } = await setup();
    const runId = await manager.start(project.id, "Fix add()");
    await manager.settled(runId);
    const first = store.getRun(runId);

    const argsFile = path.join(await tempDir(), "args.json");
    process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
    await manager.followUp(runId, "Also add a test");
    expect(store.getRun(runId)?.status).toBe("running");
    await manager.settled(runId);

    const args = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    expect(args.slice(0, 2)).toEqual(["-p", "Also add a test"]);
    expect(args[args.indexOf("--resume") + 1]).toBe("11111111-2222-3333-4444-555555555555");
    const run = store.getRun(runId);
    expect(run?.status).toBe("done");
    expect(run?.worktree).toEqual(first?.worktree);
    // Totals add up across the two turns of work.
    expect(run?.usage.outputTokens).toBe((first?.usage.outputTokens ?? 0) * 2);
    const starts = store.events(runId).filter((e) => e.event.type === "agent.start");
    expect(starts.map((e) => e.event.type === "agent.start" && e.event.task)).toEqual([
      "Fix add()",
      "Also add a test",
    ]);
  });

  test("attached images reach the agent, and slash commands run with the full setup", async () => {
    const { manager, project } = await setup();
    const argsFile = path.join(await tempDir(), "args.json");
    process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
    const shot = path.join(await tempDir(), "shot.png");
    const runId = await manager.start(project.id, "/security-review the upload code", {
      attachments: [shot],
    });
    await manager.settled(runId);

    const args = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    expect(args[1]).toContain("/security-review the upload code\n\n[Attached images]");
    expect(args[1]).toContain(`- ${shot}`);
    expect(args[args.indexOf("--add-dir") + 1]).toBe(path.dirname(shot));
    expect(args).not.toContain("--disable-slash-commands");

    // A follow-up without images is a plain, lean turn.
    await manager.followUp(runId, "Thanks");
    await manager.settled(runId);
    const next = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    expect(next[1]).toBe("Thanks");
    expect(next).not.toContain("--add-dir");
    expect(next).toContain("--disable-slash-commands");
  });

  test("asks before a command that isn't allowed, and remembers 'always'", async () => {
    process.env.FAKE_CLAUDE_MODE = "ask";
    const answerFile = path.join(await tempDir(), "answer.json");
    process.env.FAKE_CLAUDE_ANSWER_FILE = answerFile;
    const { store, manager, project } = await setup();
    const runId = await manager.start(project.id, "Check the Xcode version");
    // The run waits for the user.
    let request = manager.pendingApproval(runId);
    for (let i = 0; !request && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 20));
      request = manager.pendingApproval(runId);
    }
    expect(request).toMatchObject({ tool: "Bash", rule: "Bash(xcodebuild:*)" });
    await manager.answerApproval(runId, request?.id ?? "", "always");
    await manager.settled(runId);

    const answer = JSON.parse(await readFile(answerFile, "utf8")) as {
      response: { response: { behavior: string; updatedPermissions?: unknown[] } };
    };
    expect(answer.response.response.behavior).toBe("allow");
    expect(answer.response.response.updatedPermissions).toHaveLength(1);
    const ran = store
      .events(runId)
      .find((e) => e.event.type === "tool.result" && e.event.id === "toolu_3")?.event;
    expect(ran?.type === "tool.result" && ran.ok).toBe(true);
    expect(store.getProject(project.id)?.actions?.alwaysAllow).toEqual(["Bash(xcodebuild:*)"]);
    expect(manager.pendingApproval(runId)).toBeUndefined();
  });

  test("a denied command reaches the agent as a refusal", async () => {
    process.env.FAKE_CLAUDE_MODE = "ask";
    const { store, manager, project } = await setup();
    const runId = await manager.start(project.id, "Check the Xcode version");
    let request = manager.pendingApproval(runId);
    for (let i = 0; !request && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 20));
      request = manager.pendingApproval(runId);
    }
    await manager.answerApproval(runId, request?.id ?? "", "deny");
    await manager.settled(runId);
    const ran = store
      .events(runId)
      .find((e) => e.event.type === "tool.result" && e.event.id === "toolu_3")?.event;
    expect(ran?.type === "tool.result" && ran.ok).toBe(false);
    expect(ran?.type === "tool.result" && ran.output).toMatch(/said no/);
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
      summary: expect.stringMatching(/^Codex isn't supported yet\./),
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
