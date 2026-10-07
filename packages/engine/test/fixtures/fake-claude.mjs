#!/usr/bin/env node
// Stands in for the `claude` CLI in tests. Replays the stream-json shapes
// captured from a real `claude -p --output-format stream-json --verbose` run,
// and performs a real file edit so the worktree has a diff.
import { execFileSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const mode = process.env.FAKE_CLAUDE_MODE ?? "success";
// With --input-format stream-json the task arrives on stdin, and so do answers
// to permission prompts.
const streamed = args.includes("--input-format");
const lines = streamed ? createInterface({ input: process.stdin })[Symbol.asyncIterator]() : null;
const nextMessage = async () => JSON.parse((await lines.next()).value);
const prompt = streamed ? (await nextMessage()).message.content : args[1];
// Recorded as ["-p", <task>, ...flags] either way, so tests can read the task.
if (process.env.FAKE_CLAUDE_ARGS_FILE)
  writeFileSync(
    process.env.FAKE_CLAUDE_ARGS_FILE,
    JSON.stringify(streamed ? ["-p", prompt, ...args.slice(1)] : args),
  );
const session = args.includes("--resume")
  ? args[args.indexOf("--resume") + 1]
  : "11111111-2222-3333-4444-555555555555";
const out = (o) => process.stdout.write(JSON.stringify(o) + "\n");

// Plays an older Claude Code that doesn't know the lean flags.
if (process.env.FAKE_CLAUDE_REJECT_LEAN && args.includes("--strict-mcp-config")) {
  process.stderr.write("error: unknown option '--strict-mcp-config'\n");
  process.exit(1);
}
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
  slash_commands: ["init", "security-review", "model", "clear", "doctor", "my-skill", "__internal"],
  terminal_slash_commands: ["doctor"],
  skills: ["my-skill"],
  plugins: [],
});
out({ type: "system", subtype: "commands_changed", commands: [] });
// "chat": the user says something while it works; Claude Code replays it once read.
if (mode === "chat") {
  const said = await nextMessage();
  if (process.env.FAKE_CLAUDE_SAID_FILE)
    writeFileSync(process.env.FAKE_CLAUDE_SAID_FILE, said.message.content);
  out({ type: "user", isReplay: true, message: { role: "user", content: said.message.content } });
}
// "early" plays a resumed session that reports a leftover, empty "done" first.
if (mode === "early")
  out({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "",
    session_id: session,
    num_turns: 0,
  });
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
        is_error: mode === "fail" || mode === "denied",
        content: [
          {
            type: "text",
            text:
              mode === "fail"
                ? "1 test failed"
                : mode === "denied"
                  ? "Permission for this tool use was denied. It requires approval, and this session has no approval surface"
                  : "3 tests passed",
          },
        ],
      },
    ],
  },
  parent_tool_use_id: null,
  session_id: session,
});
out({ type: "rate_limit_event", rate_limit_info: { status: "allowed" } });
// "ask" wants to run a command that needs approval, like a real xcodebuild call.
if (mode === "ask") {
  const input = { command: "cd app && xcodebuild -version" };
  out({
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      content: [{ type: "tool_use", id: "toolu_3", name: "Bash", input }],
      usage: {},
    },
    parent_tool_use_id: null,
    session_id: session,
  });
  out({
    type: "control_request",
    request_id: "req-1",
    request: {
      subtype: "can_use_tool",
      tool_name: "Bash",
      input,
      description: input.command,
      decision_reason: "This command requires approval",
      tool_use_id: "toolu_3",
    },
  });
  // Skip helloagents' own requests (like a mode switch) until the answer arrives.
  let answer = await nextMessage();
  while (answer.type !== "control_response") answer = await nextMessage();
  const allowed = answer.response.response.behavior === "allow";
  if (process.env.FAKE_CLAUDE_ANSWER_FILE)
    writeFileSync(process.env.FAKE_CLAUDE_ANSWER_FILE, JSON.stringify(answer));
  out({
    type: "user",
    message: {
      role: "user",
      content: [
        {
          tool_use_id: "toolu_3",
          type: "tool_result",
          is_error: !allowed,
          content: allowed ? "Xcode 26.0" : answer.response.response.message,
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: session,
  });
}
// "rich" ends with a formatted answer, like a real explanation from Claude Code.
const RICH = [
  "**stats-lib** is a tiny statistics library.",
  "",
  "## What changed",
  "1. `add()` now returns `a + b` instead of `a - b`.",
  "2. Added a comment so the fix is easy to spot.",
  "",
  "| File | Change |",
  "| --- | --- |",
  "| `math.js` | fixed `add()` |",
  "",
  "> All 3 tests pass. See the [Node test runner docs](https://nodejs.org/api/test.html).",
].join("\n");
if (mode === "rich") {
  out({
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      content: [{ type: "text", text: RICH }],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 2,
        output_tokens: 90,
        cache_read_input_tokens: 10400,
        cache_creation_input_tokens: 0,
      },
    },
    parent_tool_use_id: null,
    session_id: session,
  });
}
// "background" leaves a download running, ends its turn, and carries on when it finishes,
// the way Claude Code does when its stdin is kept open.
if (mode === "background") {
  out({
    type: "system",
    subtype: "background_tasks_changed",
    tasks: [
      { task_id: "b1", task_type: "local_bash", description: "xcodebuild -downloadPlatform iOS" },
    ],
  });
  out({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "Downloading in the background.",
    session_id: session,
  });
  await new Promise((r) => setTimeout(r, 300));
  out({ type: "system", subtype: "background_tasks_changed", tasks: [] });
  out({
    type: "system",
    subtype: "init",
    cwd: process.cwd(),
    session_id: session,
    model: "claude-opus-5-5",
    tools: [],
  });
  out({
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      content: [{ type: "text", text: "The download finished." }],
      usage: {},
    },
    parent_tool_use_id: null,
    session_id: session,
  });
  out({
    type: "result",
    subtype: "success",
    is_error: false,
    result: "The download finished.",
    session_id: session,
  });
} else if (mode === "error") {
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
  // "helper": uses the `helloagents` command, like an agent asked to start a run and ship.
  // The run it starts gets a different task, so it doesn't start runs itself.
  if (mode === "helper" && !prompt.includes("Write the docs")) {
    const said = [];
    for (const args of [["new", "Write the docs"], ["commit"], ["merge"], ["fly"]]) {
      try {
        said.push(execFileSync("helloagents", args, { encoding: "utf8", stdio: "pipe" }));
      } catch (e) {
        said.push(`failed: ${e.stdout}`);
      }
    }
    writeFileSync(process.env.FAKE_CLAUDE_HELPER_OUT, said.join(""));
  }
  out({
    type: "result",
    subtype: "success",
    is_error: false,
    result: mode === "rich" ? RICH : "Fixed add() and the tests pass.",
    total_cost_usd: 0.42,
    session_id: session,
    num_turns: 2,
  });
}
