import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
  failureExcerpt,
  reply,
  runAgent,
  ScriptedModel,
  toErrors,
  toLogLines,
  TraceStore,
} from "../src/index";
import { workspace } from "./helpers";

const stores: TraceStore[] = [];
afterEach(() => stores.splice(0).forEach((s) => s.close()));
const open = (file = ":memory:") => {
  const s = new TraceStore(file);
  stores.push(s);
  return s;
};

async function recordedRun(store: TraceStore) {
  const ws = await workspace({ "math.js": "export const add = (a, b) => a - b;\n" });
  let t = 1000;
  const runId = store.createRun({
    title: "Fix add()",
    workspace: ws,
    model: "claude-opus-5",
    startedAt: t,
  });
  await runAgent({
    task: "Fix add()",
    workspace: ws,
    allowedCommands: ["node"],
    now: () => (t += 100),
    onEvent: store.recorder(runId),
    model: new ScriptedModel([
      reply({
        text: "Checking math.js.",
        tools: [{ name: "read_file", input: { path: "math.js" } }],
      }),
      reply({
        tools: [
          {
            name: "run_command",
            input: {
              command: "node",
              args: ["-e", "console.error('1 test failed'); process.exit(1)"],
            },
          },
        ],
      }),
      reply({
        tools: [
          { name: "edit_file", input: { path: "math.js", old_text: "a - b", new_text: "a + b" } },
        ],
      }),
      reply({ tools: [{ name: "finish", input: { summary: "Fixed add()." } }] }),
    ]),
  });
  return runId;
}

describe("TraceStore", () => {
  test("records a whole run and closes it with the final status, cost and summary", async () => {
    const store = open();
    const runId = await recordedRun(store);
    const run = store.getRun(runId);
    expect(run).toMatchObject({
      title: "Fix add()",
      status: "done",
      summary: "Fixed add().",
      error: null,
    });
    expect(run?.costUsd).toBeGreaterThan(0);
    expect(run?.usage.inputTokens).toBe(4000);
    expect(run?.endedAt).toBeGreaterThan(run?.startedAt ?? Infinity);
  });

  test("returns events in order, and only new ones after a sequence number", async () => {
    const store = open();
    const runId = await recordedRun(store);
    const all = store.events(runId);
    expect(all.map((e) => e.event.type)).toEqual([
      "agent.start",
      "model.response",
      "tool.result",
      "model.response",
      "tool.result",
      "model.response",
      "tool.result",
      "model.response",
      "tool.result",
      "agent.end",
    ]);
    const third = all[2]!.seq;
    expect(store.events(runId, { afterSeq: third }).map((e) => e.seq)).toEqual(
      all.slice(3).map((e) => e.seq),
    );
  });

  test("filters events by agent", () => {
    const store = open();
    const runId = store.createRun({ title: "t", workspace: "/w", model: "m" });
    store.record(runId, "h1", {
      type: "agent.start",
      at: 1,
      task: "a",
      model: "m",
      workspace: "/w",
    });
    store.record(runId, "cc", {
      type: "agent.start",
      at: 2,
      task: "b",
      model: "m",
      workspace: "/w",
    });
    expect(store.events(runId, { agentId: "cc" }).map((e) => e.agentId)).toEqual(["cc"]);
  });

  test("a non-main agent finishing doesn't close the run", () => {
    const store = open();
    const runId = store.createRun({ title: "t", workspace: "/w", model: "m" });
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
    store.record(runId, "h1", {
      type: "agent.end",
      at: 5,
      status: "done",
      summary: "ok",
      turns: 1,
      usage,
      costUsd: 0.1,
    });
    expect(store.getRun(runId)?.status).toBe("running");
  });

  test("lists newest runs first and finds runs by id prefix", () => {
    const store = open();
    const a = store.createRun({
      id: "aaaa-1",
      title: "older",
      workspace: "/w",
      model: "m",
      startedAt: 1,
    });
    store.createRun({ id: "bbbb-2", title: "newer", workspace: "/w", model: "m", startedAt: 2 });
    expect(store.listRuns().map((r) => r.title)).toEqual(["newer", "older"]);
    expect(store.findRun("aaaa")?.id).toBe(a);
    expect(store.findRun("zzzz")).toBeUndefined();
  });

  test("keeps data across restarts and upgrades the schema only once", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "helloagents-db-"));
    try {
      const file = path.join(dir, "nested", "trace.db");
      const first = new TraceStore(file);
      const id = first.createRun({ title: "persisted", workspace: "/w", model: "m" });
      first.close();
      const second = open(file);
      expect(second.getRun(id)?.title).toBe("persisted");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("deleting a run deletes its events", async () => {
    const store = open();
    const runId = await recordedRun(store);
    store.deleteRun(runId);
    expect(store.getRun(runId)).toBeUndefined();
    expect(store.events(runId)).toEqual([]);
  });
});

describe("log and error views", () => {
  test("turn events into readable log lines with levels", async () => {
    const store = open();
    const runId = await recordedRun(store);
    const lines = toLogLines(store.events(runId));
    expect(lines[0]).toMatchObject({
      level: "INFO",
      source: "main",
      message: "started on claude-opus-5",
    });
    expect(lines.find((l) => l.message.startsWith("read_file"))).toMatchObject({
      level: "INFO",
      message: "read_file math.js",
    });
    expect(lines.find((l) => l.level === "ERROR")?.message).toMatch(/^node -e .* → exit code 1$/);
    expect(lines.at(-1)).toMatchObject({
      level: "INFO",
      message: expect.stringMatching(/^done after 4 turns · \$/),
    });
    expect(lines.find((l) => l.message.startsWith("turn 1"))?.message).toContain(
      '"Checking math.js."',
    );
  });

  test("collect failed commands as errors with their full output", async () => {
    const store = open();
    const runId = await recordedRun(store);
    const errors = toErrors(store.events(runId));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.title).toMatch(/^node -e .* failed$/);
    expect(errors[0]!.detail).toBe("exit code 1\n1 test failed");
  });

  test("a failed run is an error too", () => {
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const errors = toErrors([
      {
        agentId: "main",
        event: {
          type: "agent.end",
          at: 1,
          status: "error",
          summary: "The run failed.",
          turns: 1,
          usage,
          costUsd: 0,
          error: "overloaded",
        },
      },
    ]);
    expect(errors).toEqual([
      {
        at: 1,
        source: "main",
        title: "The run failed.",
        detail: "overloaded",
        excerpt: "overloaded",
      },
    ]);
  });
});

describe("failureExcerpt", () => {
  test("keeps failure lines and the line after each, from noisy test output", () => {
    const tap = [
      "TAP version 13",
      "# Subtest: mean",
      "ok 1 - mean",
      "# Subtest: range",
      "not ok 2 - range",
      "  ---",
      "  duration_ms: 0.08",
      "  error: |-",
      "    Expected values to be strictly equal:",
      "    NaN !== 11",
      "  stack: |-",
      "    at x (file.js:1:1)",
      "# pass 1",
      "# fail 1",
    ].join("\n");
    expect(failureExcerpt(tap)).toBe(
      [
        "not ok 2 - range",
        "  ---",
        "  error: |-",
        "    Expected values to be strictly equal:",
        "    NaN !== 11",
        "# fail 1",
      ].join("\n"),
    );
  });

  test("falls back to the end of the output when nothing looks like a failure", () => {
    expect(failureExcerpt("a\nb\nc", 2)).toBe("b\nc");
  });

  test("caps very long output", () => {
    const out = Array.from({ length: 100 }, (_, i) => `Error ${i}`).join("\n");
    expect(failureExcerpt(out, 5).split("\n").at(-1)).toBe("… 95 more lines");
  });
});
