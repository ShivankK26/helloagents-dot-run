// Logs and errors, derived from events. No Node imports: the app window uses
// these too, so they must work as browser code.
import type { AgentEvent } from "../types";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface LogLine {
  at: number;
  level: LogLevel;
  /** Who it's about: an agent id, or "orchestrator". */
  source: string;
  message: string;
}

export interface RunError {
  at: number;
  source: string;
  title: string;
  /** The raw output (test failures, stack traces). */
  detail: string;
  /** The lines of `detail` that explain the failure, for showing first. */
  excerpt: string;
}

const SIGNAL =
  /\b(not ok|fail(ed|ure)?|error|expected|actual|assert|exception|traceback|panic)\b|✗|×|✖/i;

/**
 * Picks the lines a person would look at in test or build output: failures,
 * errors and assertion messages, each with a line of context after it.
 */
export function failureExcerpt(output: string, maxLines = 24): string {
  const lines = output.split("\n");
  const keep = new Set<number>();
  lines.forEach((line, i) => {
    if (!SIGNAL.test(line)) return;
    keep.add(i);
    if (i + 1 < lines.length) keep.add(i + 1);
  });
  if (keep.size === 0) return lines.slice(-maxLines).join("\n").trim();
  const picked = [...keep]
    .sort((a, b) => a - b)
    .slice(0, maxLines)
    .map((i) => lines[i] ?? "");
  const more = keep.size > maxLines ? `\n… ${keep.size - maxLines} more lines` : "";
  return picked.join("\n").trim() + more;
}

interface WithAgent {
  agentId: string;
  event: AgentEvent;
}

const oneLine = (s: string, max = 160) => {
  const first = s.split("\n").find((l) => l.trim()) ?? "";
  return first.length > max ? `${first.slice(0, max - 1)}…` : first;
};

/** Tools that run shell commands: the built-in harness's and Claude Code's. */
export const isCommandTool = (name: string) =>
  name === "run_command" || name === "Bash" || name === "checks" || name === "setup";

export function describeToolCall(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "run_command") return [i.command, ...((i.args as unknown[]) ?? [])].join(" ");
  if (name === "Bash") return String(i.command ?? "Bash");
  if (name === "checks" || name === "setup") {
    const cmds = Array.isArray(i.commands) ? (i.commands as unknown[]).map(String) : [];
    return `${name === "checks" ? "Checks" : "Setup"}: ${cmds.join(", ")}`;
  }
  if (name === "finish") return "finish";
  // Claude Code names the target file_path or pattern; the harness uses path.
  const target = [i.path, i.file_path, i.pattern, i.url].find((v) => typeof v === "string");
  return `${name} ${typeof target === "string" ? target : ""}`.trim();
}

/** Turns events into readable log lines, oldest first. */
export function toLogLines(events: WithAgent[]): LogLine[] {
  const lines: LogLine[] = [];
  for (const { agentId: source, event: e } of events) {
    switch (e.type) {
      case "agent.start":
        lines.push({ at: e.at, level: "INFO", source, message: `started on ${e.model}` });
        break;
      case "model.response": {
        // New tokens; the cache re-read of the conversation is listed separately.
        const tokens = e.usage.inputTokens + e.usage.outputTokens + e.usage.cacheWriteTokens;
        const cached = e.usage.cacheReadTokens
          ? ` (+${e.usage.cacheReadTokens.toLocaleString("en-US")} cached)`
          : "";
        const said = e.text ? ` · "${oneLine(e.text, 100)}"` : "";
        const fallback = e.stopReason === "refusal" ? "ERROR" : "INFO";
        lines.push({
          at: e.at,
          level: fallback,
          source,
          message: `turn ${e.turn} · ${tokens.toLocaleString("en-US")} tokens${cached} · ${(e.durationMs / 1000).toFixed(1)}s${said}`,
        });
        break;
      }
      case "tool.result":
        lines.push({
          at: e.at,
          level: e.ok ? "INFO" : isCommandTool(e.name) ? "ERROR" : "WARN",
          source,
          message: `${describeToolCall(e.name, e.input)}${e.ok ? "" : ` → ${oneLine(e.output)}`}`,
        });
        break;
      case "agent.end":
        lines.push({
          at: e.at,
          level:
            e.status === "done"
              ? "INFO"
              : e.status === "cancelled" || e.status === "budget"
                ? "WARN"
                : "ERROR",
          source,
          message: `${e.status} after ${e.turns} turn${e.turns === 1 ? "" : "s"} · $${e.costUsd.toFixed(2)}${e.error ? ` · ${e.error}` : ""}`,
        });
        break;
    }
  }
  return lines;
}

/** Things that went wrong: failed commands (usually tests), refusals and failed runs. */
export function toErrors(events: WithAgent[]): RunError[] {
  const errors: RunError[] = [];
  for (const { agentId: source, event: e } of events) {
    if (e.type === "tool.result" && !e.ok && isCommandTool(e.name)) {
      errors.push({
        at: e.at,
        source,
        title: `${describeToolCall(e.name, e.input)} failed`,
        detail: e.output,
        excerpt: failureExcerpt(e.output),
      });
    }
    if (
      e.type === "agent.end" &&
      (e.status === "error" || e.status === "refused" || e.status === "context_full")
    ) {
      errors.push({
        at: e.at,
        source,
        title: e.summary,
        detail: e.error ?? "",
        excerpt: e.error ?? "",
      });
    }
  }
  return errors;
}

/** What a tool call does, for grouping activity and working out a run's stage. */
export type ToolKind = "read" | "edit" | "command" | "other";

export function toolKind(name: string): ToolKind {
  if (/^(Read|Glob|Grep|LS|read_file|list_files|search_files)$/.test(name)) return "read";
  if (/^(Edit|Write|MultiEdit|NotebookEdit|write_file|edit_file)$/.test(name)) return "edit";
  if (isCommandTool(name)) return "command";
  return "other";
}

/** The file a read or edit touched, when there is one. */
export function toolPath(input: unknown): string | undefined {
  const i = (input ?? {}) as Record<string, unknown>;
  const p = i.file_path ?? i.path ?? i.notebook_path;
  return typeof p === "string" ? p : undefined;
}

const TEST_COMMAND =
  /\b(test|tests|jest|vitest|pytest|mocha|ava|playwright|rspec|phpunit|unittest)\b|go test|cargo test/i;

/** "14 passed", "1 failed · 13 passed", or a plain verdict when no counts are printed. */
export function testResultLine(output: string, ok: boolean): string {
  const count = (re: RegExp) => {
    const all = [...output.matchAll(re)];
    return all.length ? Number(all[all.length - 1]?.[1]) : undefined;
  };
  const passed = count(/(\d+)\s+(?:passed|passing)\b/gi);
  const failed = count(/(\d+)\s+(?:failed|failing)\b/gi);
  if (failed)
    return passed !== undefined ? `${failed} failed · ${passed} passed` : `${failed} failed`;
  if (passed !== undefined) return `${passed} passed`;
  return ok ? "passed" : "failed";
}

/** The four plain stages shown while a run works. */
export type RunStage = "read" | "edit" | "test" | "wrap";

export interface RunDigest {
  /** Distinct files the agent read. */
  filesRead: number;
  /** Distinct files the agent edited or created, in order. */
  filesChanged: string[];
  commands: number;
  /** The last test command's result, if the agent ran tests. */
  tests: {
    passed: boolean;
    line: string;
    command: string;
    /** The checks couldn't even start (e.g. too old a Node): why, in plain words. */
    cantStart?: string;
  } | null;
  /** Where a running agent is now: the most advanced stage it has reached. */
  stage: RunStage;
  /** The agent's last message: for a question, the answer. */
  answer: string;
  /** Commands still running in the background, and since when. */
  background: { tasks: string[]; since: number } | null;
}

/** A small summary of a run, built from its events. */
export function digestRun(events: WithAgent[]): RunDigest {
  const read = new Set<string>();
  const changed: string[] = [];
  let commands = 0;
  let tests: RunDigest["tests"] = null;
  let stage: RunStage = "read";
  let answer = "";
  let checked = false;
  let background: RunDigest["background"] = null;
  // Files the agent wrote outside the project (e.g. its own notes in ~/.claude) aren't changes.
  let workspace = "";
  const inProject = (file: string) =>
    !file.startsWith("/") || !workspace || file.startsWith(`${workspace}/`);
  const rank: Record<RunStage, number> = { read: 0, edit: 1, test: 2, wrap: 3 };
  const reach = (s: RunStage) => {
    if (rank[s] > rank[stage]) stage = s;
  };
  for (const { event: e } of events) {
    if (e.type === "agent.background")
      background = e.tasks.length
        ? {
            tasks: e.tasks.map((t) => t.description),
            since: (background as RunDigest["background"])?.since ?? e.at,
          }
        : null;
    if (e.type === "agent.end") background = null;
    if (e.type === "agent.start") {
      stage = "read"; // a follow-up starts over
      workspace = e.workspace;
    }
    if (e.type === "model.response" && e.text.trim()) answer = e.text.trim();
    if (e.type === "model.response") {
      for (const call of e.toolCalls) {
        const kind = toolKind(call.name);
        if (kind === "edit") reach("edit");
        if (kind === "command" && TEST_COMMAND.test(describeToolCall(call.name, call.input)))
          reach("test");
      }
    }
    if (e.type !== "tool.result") continue;
    const kind = toolKind(e.name);
    const file = toolPath(e.input);
    if (kind === "read" && file) read.add(file);
    if (kind === "edit") {
      if (file && inProject(file) && !changed.includes(file)) changed.push(file);
      reach("edit");
    }
    if (kind === "command") {
      const command = describeToolCall(e.name, e.input);
      if (e.name === "checks") {
        // The project's own checks are the verdict, whatever the agent ran before.
        const counted = testResultLine(e.output, e.ok);
        const cantStart = (e.input as { cantStart?: unknown }).cantStart;
        tests = {
          passed: e.ok,
          line: /\d/.test(counted) ? counted : e.ok ? "checks pass" : "checks fail",
          command,
          ...(typeof cantStart === "string" && { cantStart }),
        };
        checked = true;
        reach("test");
        continue;
      }
      if (e.name === "setup") continue; // the app's step, not the agent's work
      commands++;
      if (!checked && TEST_COMMAND.test(command)) {
        tests = { passed: e.ok, line: testResultLine(e.output, e.ok), command };
        reach("test");
      }
    }
  }
  return {
    filesRead: read.size,
    filesChanged: changed,
    commands,
    tests,
    stage,
    answer,
    background,
  };
}

/** The first paragraph of an answer, without Markdown headings: what a summary shows first. */
export function firstParagraph(text: string): string {
  const blocks = text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b && !/^(#{1,6}\s|```|\||[-*+]\s|\d+[.)]\s)/.test(b));
  return (blocks[0] ?? text.trim()).replace(/\s*\n\s*/g, " ");
}
