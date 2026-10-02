import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { costOf, reply, runAgent, ScriptedModel, type AgentEvent } from "../src/index";
import { workspace } from "./helpers";

const BUGGY = { "math.js": "export const add = (a, b) => a - b;\n" };

async function run(
  model: ScriptedModel,
  ws: string,
  extra: Partial<Parameters<typeof runAgent>[0]> = {},
) {
  const events: AgentEvent[] = [];
  let t = 0;
  const result = await runAgent({
    task: "Fix add()",
    workspace: ws,
    model,
    allowedCommands: ["node"],
    onEvent: (e) => events.push(e),
    now: () => (t += 10),
    ...extra,
  });
  return { result, events };
}

describe("runAgent", () => {
  test("reads, edits, runs a check, and finishes", async () => {
    const ws = await workspace(BUGGY);
    const model = new ScriptedModel([
      reply({
        text: "I'll look at math.js first.",
        tools: [{ name: "read_file", input: { path: "math.js" } }],
      }),
      reply({
        tools: [
          { name: "edit_file", input: { path: "math.js", old_text: "a - b", new_text: "a + b" } },
        ],
      }),
      reply({
        tools: [
          {
            name: "run_command",
            input: {
              command: "node",
              args: [
                "-e",
                "import('./math.js').then(m => process.exit(m.add(2, 2) === 4 ? 0 : 1))",
              ],
            },
          },
        ],
      }),
      reply({
        tools: [
          {
            name: "finish",
            input: { summary: "add() subtracted; it now adds. Checked 2 + 2 = 4." },
          },
        ],
      }),
    ]);
    const { result, events } = await run(model, ws);

    expect(result).toMatchObject({
      status: "done",
      summary: "add() subtracted; it now adds. Checked 2 + 2 = 4.",
      turns: 4,
    });
    expect(await readFile(path.join(ws, "math.js"), "utf8")).toBe(
      "export const add = (a, b) => a + b;\n",
    );
    expect(events.map((e) => (e.type === "tool.result" ? `${e.name}:${e.ok}` : e.type))).toEqual([
      "agent.start",
      "model.response",
      "read_file:true",
      "model.response",
      "edit_file:true",
      "model.response",
      "run_command:true",
      "model.response",
      "finish:true",
      "agent.end",
    ]);
    expect(result.costUsd).toBeCloseTo(
      4 *
        costOf("claude-opus-5", {
          inputTokens: 1000,
          outputTokens: 200,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
        }),
    );
  });

  test("sends the system prompt and tools, and the whole history each turn", async () => {
    const ws = await workspace(BUGGY);
    const model = new ScriptedModel([
      reply({ tools: [{ name: "read_file", input: { path: "math.js" }, id: "t1" }] }),
      reply({ tools: [{ name: "finish", input: { summary: "done" } }] }),
    ]);
    await run(model, ws);
    const second = model.requests[1]!;
    expect(second.system).toMatch(/coding agent/);
    expect(second.tools).toHaveLength(6);
    expect(second.messages.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(second.messages[2]!.content).toEqual([
      {
        type: "tool_result",
        tool_use_id: "t1",
        content: "1 | export const add = (a, b) => a - b;\n2 | ",
      },
    ]);
  });

  test("returns every tool result of a turn in one message, errors marked", async () => {
    const ws = await workspace(BUGGY);
    const model = new ScriptedModel([
      reply({
        tools: [
          { name: "read_file", input: { path: "math.js" }, id: "a" },
          { name: "read_file", input: { path: "../secret" }, id: "b" },
        ],
      }),
      reply({ tools: [{ name: "finish", input: { summary: "ok" } }] }),
    ]);
    await run(model, ws);
    const results = model.requests[1]!.messages[2]!.content as Array<{
      tool_use_id: string;
      is_error?: boolean;
    }>;
    expect(results.map((r) => [r.tool_use_id, r.is_error ?? false])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });

  test("ending a turn without tools counts as done, using its text", async () => {
    const ws = await workspace();
    const { result } = await run(
      new ScriptedModel([reply({ text: "Nothing to change: add() is already correct." })]),
      ws,
    );
    expect(result).toMatchObject({
      status: "done",
      summary: "Nothing to change: add() is already correct.",
    });
  });

  test("stops at the turn limit", async () => {
    const ws = await workspace(BUGGY);
    const looping = () => reply({ tools: [{ name: "list_files", input: {} }] });
    const { result } = await run(new ScriptedModel([looping, looping, looping]), ws, {
      maxTurns: 2,
    });
    expect(result).toMatchObject({ status: "budget", turns: 2 });
    expect(result.summary).toMatch(/after 2 turns/);
  });

  test("stops at the cost limit", async () => {
    const ws = await workspace(BUGGY);
    const expensive = () =>
      reply({ tools: [{ name: "list_files", input: {} }], usage: { input_tokens: 400_000 } });
    const { result } = await run(new ScriptedModel([expensive, expensive]), ws, { maxCostUsd: 1 });
    expect(result.status).toBe("budget");
    expect(result.turns).toBe(1);
  });

  test("a refusal ends the run without running its tools", async () => {
    const ws = await workspace(BUGGY);
    const { result, events } = await run(
      new ScriptedModel([
        reply({
          tools: [{ name: "write_file", input: { path: "x", content: "y" } }],
          stop: "refusal",
        }),
      ]),
      ws,
    );
    expect(result.status).toBe("refused");
    expect(events.some((e) => e.type === "tool.result")).toBe(false);
  });

  test("never runs tools from a turn cut off at max_tokens", async () => {
    const ws = await workspace(BUGGY);
    const model = new ScriptedModel([
      reply({
        tools: [{ name: "write_file", input: { path: "big.js", content: "partial" } }],
        stop: "max_tokens",
      }),
      reply({ tools: [{ name: "finish", input: { summary: "ok" } }] }),
    ]);
    const { events } = await run(model, ws);
    const write = events.find((e) => e.type === "tool.result" && e.name === "write_file");
    expect(write).toMatchObject({ ok: false });
    await expect(readFile(path.join(ws, "big.js"))).rejects.toThrow();
  });

  test("prices a turn by the model that actually answered", async () => {
    const ws = await workspace();
    const { events } = await run(
      new ScriptedModel([reply({ text: "done", model: "claude-opus-4-8" })]),
      ws,
    );
    const response = events.find((e) => e.type === "model.response");
    expect(response).toMatchObject({ model: "claude-opus-4-8" });
  });

  test("model errors end the run with the message", async () => {
    const ws = await workspace();
    const model = new ScriptedModel([
      () => {
        throw new Error("overloaded");
      },
    ]);
    const { result } = await run(model, ws);
    expect(result).toMatchObject({ status: "error", error: "overloaded" });
  });

  test("cancellation stops before the next turn", async () => {
    const ws = await workspace(BUGGY);
    const controller = new AbortController();
    const model = new ScriptedModel([
      () => {
        controller.abort();
        return reply({ tools: [{ name: "list_files", input: {} }] });
      },
    ]);
    const { result } = await run(model, ws, { signal: controller.signal });
    expect(result.status).toBe("cancelled");
  });
});
