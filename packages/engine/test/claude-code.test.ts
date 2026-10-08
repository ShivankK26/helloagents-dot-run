import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test } from "vitest";
import {
  claudeArgs,
  isSlashTask,
  listSlashCommands,
  runClaudeCode,
  type AgentEvent,
  suggestedRule,
} from "../src/index";
import { tempDir, workspace } from "./helpers";

const FAKE = fileURLToPath(new URL("./fixtures/fake-claude.mjs", import.meta.url));
afterEach(() => {
  delete process.env.FAKE_CLAUDE_MODE;
  delete process.env.FAKE_CLAUDE_ARGS_FILE;
  delete process.env.FAKE_CLAUDE_REJECT_LEAN;
});

async function run(mode = "success", extra: Partial<Parameters<typeof runClaudeCode>[0]> = {}) {
  process.env.FAKE_CLAUDE_MODE = mode;
  const ws = await workspace({ "math.js": "export const add = (a, b) => a - b;\n" });
  const events: AgentEvent[] = [];
  const result = await runClaudeCode({
    task: "Fix add()",
    workspace: ws,
    claudePath: FAKE,
    onEvent: (e) => events.push(e),
    ...extra,
  });
  return { ws, events, result };
}

describe("claudeArgs", () => {
  test("runs headless with streamed JSON, auto mode and no prompts", () => {
    const args = claudeArgs({ task: "Fix it" });
    expect(args.slice(0, 2)).toEqual(["-p", "Fix it"]);
    expect(args).toEqual(
      expect.arrayContaining([
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-mode",
        "auto",
        "--permission-prompts",
        "none",
      ]),
    );
    expect(args[args.indexOf("--allowedTools") + 1]).toContain("Bash(npm *)");
    expect(args).not.toContain("--bare"); // bare mode would skip the user's Claude login
  });

  test("starts lean by default: no MCP servers, user plugins or skills, only coding tools", () => {
    const args = claudeArgs({ task: "Fix it" });
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--disable-slash-commands");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project,local");
    expect(args[args.indexOf("--tools") + 1]).toBe("Read,Edit,Write,Glob,Grep,Bash,Task");
    expect(claudeArgs({ task: "Fix it", lean: false })).not.toContain("--strict-mcp-config");
  });

  test("resumes a session to send feedback, and can cap turns", () => {
    const args = claudeArgs({ task: "2 tests failed", resumeSessionId: "abc", maxTurns: 20 });
    expect(args.slice(-4)).toEqual(["--max-turns", "20", "--resume", "abc"]);
  });
});

describe("runClaudeCode", () => {
  test("turns Claude Code's stream into harness events", async () => {
    const { events, result, ws } = await run();
    expect(events.map((e) => (e.type === "tool.result" ? `${e.name}:${e.ok}` : e.type))).toEqual([
      "agent.start",
      "model.response",
      "Edit:true",
      "model.response",
      "Bash:true",
      "agent.end",
    ]);
    expect(events[0]).toMatchObject({
      type: "agent.start",
      model: "claude-opus-5-5[1m]",
      sessionId: "11111111-2222-3333-4444-555555555555",
    });
    expect(events[1]).toMatchObject({
      type: "model.response",
      turn: 1,
      text: "I'll fix add() in math.js.",
      toolCalls: [{ name: "Edit" }],
    });
    expect(events[4]).toMatchObject({
      type: "tool.result",
      output: "3 tests passed",
      input: { command: "npm test" },
    });
    expect(result).toMatchObject({
      status: "done",
      summary: "Fixed add() and the tests pass.",
      turns: 2,
      costUsd: 0.42,
      sessionId: "11111111-2222-3333-4444-555555555555",
    });
    expect(result.usage).toEqual({
      inputTokens: 8,
      outputTokens: 60,
      cacheReadTokens: 19200,
      cacheWriteTokens: 1200,
    });
    expect(await readFile(path.join(ws, "math.js"), "utf8")).toContain("fixed by fake claude");
  });

  test("runs in the given workspace", async () => {
    const { events, ws } = await run();
    expect(events[0]).toMatchObject({ workspace: ws });
  });

  test("marks failed tool results", async () => {
    const { events } = await run("fail");
    expect(events.find((e) => e.type === "tool.result" && e.name === "Bash")).toMatchObject({
      ok: false,
      output: "1 test failed",
    });
  });

  test("reports an error result with its subtype", async () => {
    const { result } = await run("error");
    expect(result).toMatchObject({ status: "budget", error: "error_max_turns" });
  });

  test("explains a crash using the end of stderr", async () => {
    const { result } = await run("crash");
    expect(result.status).toBe("error");
    expect(result.error).toMatch(/exit code 1\nError: Invalid API key/);
  });

  test("explains a missing CLI", async () => {
    const ws = await tempDir();
    const result = await runClaudeCode({ task: "x", workspace: ws, claudePath: "/nope/claude" });
    expect(result).toMatchObject({
      status: "error",
      error: expect.stringMatching(/isn't installed/),
    });
  });

  test("passes the resume id through to the CLI", async () => {
    const argsFile = path.join(await tempDir(), "args.json");
    process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
    const { result } = await run("success", { resumeSessionId: "resume-me" });
    expect(JSON.parse(await readFile(argsFile, "utf8"))).toEqual(
      expect.arrayContaining(["--resume", "resume-me"]),
    );
    expect(result.sessionId).toBe("resume-me");
  });

  test("retries without the lean flags when Claude Code doesn't know them", async () => {
    const argsFile = path.join(await tempDir(), "args.json");
    process.env.FAKE_CLAUDE_ARGS_FILE = argsFile;
    process.env.FAKE_CLAUDE_REJECT_LEAN = "1";
    const { result, events } = await run();
    expect(result.status).toBe("done");
    // The failed first attempt leaves no trace: one start, one end.
    expect(events.filter((e) => e.type === "agent.end")).toHaveLength(1);
    expect(events[0]?.type).toBe("agent.start");
    expect(JSON.parse(await readFile(argsFile, "utf8"))).not.toContain("--strict-mcp-config");
  });
});

describe("slash commands", () => {
  test("lists what Claude Code offers, minus session-only commands, without running a turn", async () => {
    const commands = await listSlashCommands(await tempDir(), FAKE);
    expect(commands.map((c) => c.name)).toEqual([
      "init",
      "security-review",
      "my-skill",
      "figma-remote",
      "supabase",
    ]);
    expect(commands.find((c) => c.name === "my-skill")?.kind).toBe("skill");
    expect(commands[0]?.description).toMatch(/CLAUDE\.md/);
    // MCP connectors come last, with their status.
    expect(commands.at(-1)).toMatchObject({
      kind: "mcp",
      description: expect.stringMatching(/sign-in/),
    });
  });

  test("spots a slash task", () => {
    expect(isSlashTask("  /security-review now")).toBe(true);
    expect(isSlashTask("fix the /api route")).toBe(false);
  });
});

describe("always allow", () => {
  test("names the program doing the work, not the helpers around it", () => {
    expect(
      suggestedRule("Bash", {
        command:
          'cd "/x y" && xcodebuild build -scheme App > /tmp/b.log 2>&1; grep -E "error" /tmp/b.log | sort -u | head -40',
      }),
    ).toBe("Bash(xcodebuild:*)");
    expect(suggestedRule("Bash", { command: "FOO=1 pnpm test | tail -5" })).toBe("Bash(pnpm:*)");
  });
});
