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
export const isCommandTool = (name: string) => name === "run_command" || name === "Bash";

export function describeToolCall(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  if (name === "run_command") return [i.command, ...((i.args as unknown[]) ?? [])].join(" ");
  if (name === "Bash") return String(i.command ?? "Bash");
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
