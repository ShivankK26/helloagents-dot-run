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
  delete process.env.FAKE_CLAUDE_SAID_FILE;
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

  test("runs from before agents could push are told once that they can now", async () => {
    const { store, manager, project } = await setup();
    const argsFile = path.join(await tempDir(), "args.json");
    process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
    const runId = await manager.start(project.id, "Fix add()");
    await manager.settled(runId);
    const { agentRuns: _, ...old } = store.getRun(runId)?.settings ?? {};
    store.updateRunSettings(runId, old);
    const sent = async (message: string) => {
      await manager.followUp(runId, message);
      await manager.settled(runId);
      return (JSON.parse(await readFile(argsFile, "utf8")) as string[])[1];
    };
    expect(await sent("push it")).toMatch(
      /^push it\n\n\[Note from helloagents\]\nhelloagents' rules/,
    );
    expect(await sent("and merge")).toBe("and merge");
  });

  test("attached images reach the agent, and slash commands run with the full setup", async () => {
    const { repo, manager, project } = await setup();
    const argsFile = path.join(await tempDir(), "args.json");
    process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
    const shot = path.join(await tempDir(), "shot.png");
    const runId = await manager.start(project.id, "/security-review the upload code", {
      attachments: [shot],
    });
    await manager.settled(runId);

    const args = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    expect(args[1]).toContain("/security-review the upload code\n\n[Attached files]");
    expect(args[1]).toContain(`- ${shot}`);
    expect(args[args.indexOf("--add-dir") + 1]).toBe(path.dirname(shot));
    expect(args).not.toContain("--disable-slash-commands");

    // A follow-up without images; still the full Claude Code setup.
    await manager.followUp(runId, "Thanks");
    await manager.settled(runId);
    const next = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    expect(next[1]).toBe("Thanks");
    // Only the user's own project folder, no image folder.
    expect(next[next.indexOf("--add-dir") + 1]).toBe(repo);
    expect(next).not.toContain(path.dirname(shot));
    expect(next).not.toContain("--disable-slash-commands");
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

  test("'Switch to Auto' allows the command and puts the run in auto mode", async () => {
    process.env.FAKE_CLAUDE_MODE = "ask";
    const { store, manager, project } = await setup();
    const runId = await manager.start(project.id, "Check the Xcode version", { access: "edits" });
    let request = manager.pendingApproval(runId);
    for (let i = 0; !request && i < 100; i++) {
      await new Promise((r) => setTimeout(r, 20));
      request = manager.pendingApproval(runId);
    }
    await manager.answerApproval(runId, request?.id ?? "", "auto");
    await manager.settled(runId);
    expect(store.getRun(runId)?.settings.access).toBe("auto");
    const ran = store
      .events(runId)
      .find((e) => e.event.type === "tool.result" && e.event.id === "toolu_3")?.event;
    expect(ran?.type === "tool.result" && ran.ok).toBe(true);
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

  test("after commands were auto-denied, the next follow-up tells the agent that's over, once", async () => {
    process.env.FAKE_CLAUDE_MODE = "denied";
    const { manager, project } = await setup();
    const runId = await manager.start(project.id, "Build it");
    await manager.settled(runId);
    delete process.env.FAKE_CLAUDE_MODE;

    const argsFile = path.join(await tempDir(), "args.json");
    process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
    await manager.followUp(runId, "can you run it?");
    await manager.settled(runId);
    const first = JSON.parse(await readFile(argsFile, "utf8")) as string[];
    expect(first[1]).toMatch(
      /^can you run it\?\n\n\[Note from helloagents\][\s\S]*no longer apply/,
    );

    await manager.followUp(runId, "thanks");
    await manager.settled(runId);
    expect((JSON.parse(await readFile(argsFile, "utf8")) as string[])[1]).toBe("thanks");
  });

  test("waits for background commands, and the agent carries on when they finish", async () => {
    process.env.FAKE_CLAUDE_MODE = "background";
    const { store, manager, project } = await setup();
    const runId = await manager.start(project.id, "Build it");
    await manager.settled(runId);
    const events = store.events(runId).map((e) => e.event);
    const background = events.filter((e) => e.type === "agent.background");
    expect(background.map((e) => e.type === "agent.background" && e.tasks.length)).toEqual([1, 0]);
    expect(events.filter((e) => e.type === "agent.start")).toHaveLength(1);
    expect(store.getRun(runId)?.summary).toBe("The download finished.");
  });

  test("a leftover 'done' at the start of a resumed session doesn't end the turn", async () => {
    process.env.FAKE_CLAUDE_MODE = "early";
    const { store, manager, project } = await setup();
    const runId = await manager.start(project.id, "Fix add()");
    await manager.settled(runId);
    const ends = store.events(runId).filter((e) => e.event.type === "agent.end");
    expect(ends).toHaveLength(1);
    expect(store.getRun(runId)?.summary).toBe("Fixed add() and the tests pass.");
  });

  test("a message sent while it works reaches the running agent", async () => {
    process.env.FAKE_CLAUDE_MODE = "chat";
    const saidFile = path.join(await tempDir(), "said.txt");
    process.env.FAKE_CLAUDE_SAID_FILE = saidFile;
    const { store, manager, project } = await setup();
    const runId = await manager.start(project.id, "Fix add()");
    for (
      let i = 0;
      i < 100 && !store.events(runId).some((e) => e.event.type === "agent.start");
      i++
    )
      await new Promise((r) => setTimeout(r, 20));
    await manager.followUp(runId, "also add a comment");
    await manager.settled(runId);
    const said = store.events(runId).find((e) => e.event.type === "user.message")?.event;
    expect(said?.type === "user.message" && said.text).toBe("also add a comment");
    // The agent is told to do it first, then carry on; the user sees only what they typed.
    expect(await readFile(saidFile, "utf8")).toMatch(
      /^also add a comment\n\n\[Note from helloagents\].*carry on/s,
    );
    expect(store.events(runId).filter((e) => e.event.type === "agent.start")).toHaveLength(1);
  });

  test("the agent can start new runs and ship with the helloagents command", async () => {
    process.env.FAKE_CLAUDE_MODE = "helper";
    const out = path.join(await tempDir(), "helper.txt");
    process.env.FAKE_CLAUDE_HELPER_OUT = out;
    const { repo, store, manager, project } = await setup();
    const runId = await manager.start(project.id, "Fix add()", { model: "opus", access: "full" });
    await manager.settled(runId);

    const said = await readFile(out, "utf8");
    expect(said).toContain(`Started a new helloagents run in ${project.name}`);
    expect(said).toMatch(/Committed [0-9a-f]+ on helloagents\//);
    expect(said).toContain("Merged into main");
    expect(said).toMatch(/failed: .*helloagents new/s); // unknown command shows the usage

    // The new run belongs to the same project, with the same settings, on its own branch.
    const child = store.listProjectRuns(project.id).find((r) => r.id !== runId);
    expect(child).toMatchObject({
      title: "Write the docs",
      settings: { model: "opus", access: "full" },
    });
    await manager.settled(child?.id ?? "");
    const started = store
      .events(runId)
      .find((e) => e.event.type === "tool.result" && e.event.name === "run")?.event;
    expect(started?.type === "tool.result" && started.input).toMatchObject({ runId: child?.id });
    // The merge happened in the user's checkout while the agent was still working.
    expect(await git(repo, ["log", "--oneline", "main"])).toContain("Fix add()");
    expect(store.getRun(runId)?.status).toBe("done");
    delete process.env.FAKE_CLAUDE_HELPER_OUT;
    await manager.stopAll(100);
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
