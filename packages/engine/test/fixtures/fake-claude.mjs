#!/usr/bin/env node
// Stands in for the `claude` CLI in tests. Replays the stream-json shapes
// captured from a real `claude -p --output-format stream-json --verbose` run,
// and performs a real file edit so the worktree has a diff.
import { appendFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? "success";
if (process.env.FAKE_CLAUDE_ARGS_FILE)
  writeFileSync(process.env.FAKE_CLAUDE_ARGS_FILE, JSON.stringify(args));
const session = args.includes("--resume")
  ? args[args.indexOf("--resume") + 1]
  : "11111111-2222-3333-4444-555555555555";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

if (mode === "crash") {
  process.stderr.write("Error: Invalid API key · Please run /login\n");
  process.exit(1);
}

out({
  type: "system",
  subtype: "init",
  cwd: process.cwd(),
  session_id: session,
  model: "claude-opus-5-5[1m]",
  tools: ["Read", "Edit", "Bash"],
});
out({ type: "system", subtype: "commands_changed", commands: [] });
if (mode === "slow") await new Promise((r) => setTimeout(r, 20000));
out({
  type: "assistant",
  message: {
    model: "claude-opus-5-5",
    content: [
      { type: "text", text: "I'll fix add() in math.js." },
      {
        type: "tool_use",
        id: "toolu_1",
        name: "Edit",
        input: { file_path: "math.js", old_string: "a - b", new_string: "a + b" },
      },
    ],
    stop_reason: null,
    usage: {
      input_tokens: 5,
      output_tokens: 40,
      cache_read_input_tokens: 9000,
      cache_creation_input_tokens: 1200,
    },
  },
  parent_tool_use_id: null,
  session_id: session,
});
appendFileSync("math.js", "// fixed by fake claude\n");
out({
  type: "user",
  message: {
    role: "user",
    content: [
      {
        tool_use_id: "toolu_1",
        type: "tool_result",
        content: "The file math.js has been updated.",
      },
    ],
  },
  parent_tool_use_id: null,
  session_id: session,
});
// A subagent's messages carry a parent id and should be ignored.
out({
  type: "assistant",
  message: {
    model: "claude-haiku-4-5",
    content: [{ type: "text", text: "subagent chatter" }],
    usage: {},
  },
  parent_tool_use_id: "toolu_sub",
  session_id: session,
});
out({
  type: "assistant",
  message: {
    model: "claude-opus-5-5",
    content: [{ type: "tool_use", id: "toolu_2", name: "Bash", input: { command: "npm test" } }],
    stop_reason: null,
    usage: {
      input_tokens: 3,
      output_tokens: 20,
      cache_read_input_tokens: 10200,
      cache_creation_input_tokens: 0,
    },
  },
  parent_tool_use_id: null,
  session_id: session,
});
out({
  type: "user",
  message: {
    role: "user",
    content: [
      {
        tool_use_id: "toolu_2",
        type: "tool_result",
        is_error: mode === "fail",
        content: [{ type: "text", text: mode === "fail" ? "1 test failed" : "3 tests passed" }],
      },
    ],
  },
  parent_tool_use_id: null,
  session_id: session,
});
out({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } });
if (mode === "error") {
  out({
    type: "result",
    subtype: "error_max_turns",
    is_error: true,
    result: "",
    total_cost_usd: 0.42,
    session_id: session,
    num_turns: 2,
  });
} else {
  out({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Fixed add() and the tests pass.",
    total_cost_usd: 0.42,
    session_id: session,
    num_turns: 2,
  });
}
