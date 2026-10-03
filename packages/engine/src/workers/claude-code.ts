import { spawn } from "node:child_process";
import type { AgentResult } from "../harness/agent";
import { addUsage, EMPTY_USAGE } from "../harness/pricing";
import type { AgentEvent, AgentStatus, TokenUsage, ToolCall } from "../types";

export interface ClaudeCodeOptions {
  task: string;
  /** Folder Claude Code works in (a git worktree). */
  workspace: string;
  /** Continue an earlier session, e.g. to send back failing tests. */
  resumeSessionId?: string;
  /** Tools Claude Code may use without asking. */
  allowedTools?: readonly string[];
  maxTurns?: number;
  /**
   * Start Claude Code without the user's MCP servers, plugins, hooks and
   * skills, and with only the coding tools. Default true: those add tens of
   * thousands of tokens to every turn and a worker doesn't need them.
   */
  lean?: boolean;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  /** Path to the claude executable (tests point this at a fake). */
  claudePath?: string;
  now?: () => number;
}

export interface ClaudeCodeResult extends AgentResult {
  sessionId?: string;
}

/**
 * What a worker may do unattended: read and edit files, and run the usual
 * test and build commands. Anything else is denied rather than waiting for a
 * permission prompt nobody will answer.
 */
export const DEFAULT_CLAUDE_TOOLS = [
  "Read",
  "Edit",
  "Write",
  "Glob",
  "Grep",
  "Bash(npm *)",
  "Bash(pnpm *)",
  "Bash(yarn *)",
  "Bash(npx *)",
  "Bash(node *)",
  "Bash(bun *)",
  "Bash(pytest *)",
  "Bash(python *)",
  "Bash(python3 *)",
  "Bash(uv *)",
  "Bash(go *)",
  "Bash(cargo *)",
  "Bash(make *)",
  "Bash(git status *)",
  "Bash(git diff *)",
  "Bash(git log *)",
  "Bash(ls *)",
] as const;

/** Built-in tools a lean worker gets at all (allowedTools then limits Bash). */
export const LEAN_CLAUDE_TOOLS = ["Read", "Edit", "Write", "Glob", "Grep", "Bash"] as const;

export function claudeArgs(
  opts: Pick<ClaudeCodeOptions, "task" | "resumeSessionId" | "allowedTools" | "maxTurns" | "lean">,
): string[] {
  const args = [
    "-p",
    opts.task,
    "--output-format",
    "stream-json",
    "--verbose",
    // File edits need no approval; everything else is limited to allowedTools.
    "--permission-mode",
    "acceptEdits",
    "--allowedTools",
    (opts.allowedTools ?? DEFAULT_CLAUDE_TOOLS).join(","),
    // Nobody is there to answer a prompt: deny instead of waiting forever.
    "--permission-prompts",
    "none",
  ];
  if (opts.lean ?? true) {
    args.push(
      // No MCP servers (none are passed with --mcp-config).
      "--strict-mcp-config",
      // The project's settings still apply; the user's plugins and hooks don't.
      "--setting-sources",
      "project,local",
      "--disable-slash-commands",
      "--tools",
      LEAN_CLAUDE_TOOLS.join(","),
    );
  }
  if (opts.maxTurns) args.push("--max-turns", String(opts.maxTurns));
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  return args;
}

/**
 * Runs Claude Code headless (`claude -p`) on the user's own Claude plan and
 * translates its stream into the same events as the built-in harness, so
 * traces, logs and errors work identically for both.
 */
export function runClaudeCode(opts: ClaudeCodeOptions): Promise<ClaudeCodeResult> {
  const now = opts.now ?? Date.now;
  const emit = opts.onEvent ?? (() => {});
  const pending = new Map<string, ToolCall>();
  let usage: TokenUsage = EMPTY_USAGE;
  let turns = 0;
  let lastAt = now();
  let sessionId = opts.resumeSessionId;
  let lastText = "";
  let ended = false;
  let stderr = "";

  const end = (
    status: AgentStatus,
    summary: string,
    costUsd: number,
    error?: string,
  ): ClaudeCodeResult => {
    ended = true;
    const result: ClaudeCodeResult = {
      status,
      summary,
      turns,
      usage,
      costUsd,
      ...(error && { error }),
      ...(sessionId && { sessionId }),
    };
    emit({
      type: "agent.end",
      at: now(),
      status,
      summary,
      turns,
      usage,
      costUsd,
      ...(error && { error }),
      ...(sessionId && { sessionId }),
    });
    return result;
  };

  return new Promise((resolve) => {
    let result: ClaudeCodeResult | undefined;
    const child = spawn(opts.claudePath ?? "claude", claudeArgs(opts), {
      cwd: opts.workspace,
      // Closing stdin stops Claude Code from waiting for piped input.
      stdio: ["ignore", "pipe", "pipe"],
      signal: opts.signal,
    });

    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) handle(line);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-4000);
    });

    function handle(line: string): void {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line) as Record<string, unknown>;
      } catch {
        return; // not one of Claude Code's JSON events
      }
      const at = now();
      if (msg.type === "system" && msg.subtype === "init") {
        sessionId = msg.session_id as string;
        emit({
          type: "agent.start",
          at,
          task: opts.task,
          model: String(msg.model ?? "claude-code"),
          workspace: opts.workspace,
          sessionId,
        });
        return;
      }
      if (msg.type === "assistant") {
        // Messages from subagents carry a parent id; keep the main conversation only.
        if (msg.parent_tool_use_id) return;
        const m = msg.message as {
          model?: string;
          content?: Array<Record<string, unknown>>;
          stop_reason?: string | null;
          usage?: Record<string, number>;
        };
        turns++;
        const text = (m.content ?? [])
          .filter((b) => b.type === "text")
          .map((b) => String(b.text))
          .join("\n")
          .trim();
        if (text) lastText = text;
        const toolCalls: ToolCall[] = (m.content ?? [])
          .filter((b) => b.type === "tool_use")
          .map((b) => ({ id: String(b.id), name: String(b.name), input: b.input }));
        for (const call of toolCalls) pending.set(call.id, call);
        const u = m.usage ?? {};
        const turnUsage: TokenUsage = {
          inputTokens: u.input_tokens ?? 0,
          outputTokens: u.output_tokens ?? 0,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
        };
        usage = addUsage(usage, turnUsage);
        emit({
          type: "model.response",
          at,
          turn: turns,
          durationMs: at - lastAt,
          model: m.model ?? "claude-code",
          stopReason: m.stop_reason ?? (toolCalls.length ? "tool_use" : null),
          text,
          toolCalls,
          usage: turnUsage,
          // Runs on the user's plan; the CLI reports an estimate only at the end.
          costUsd: 0,
        });
        lastAt = at;
        return;
      }
      if (msg.type === "user") {
        if (msg.parent_tool_use_id) return;
        const content = (msg.message as { content?: unknown }).content;
        if (!Array.isArray(content)) return;
        for (const block of content as Array<Record<string, unknown>>) {
          if (block.type !== "tool_result") continue;
          const id = String(block.tool_use_id);
          const call = pending.get(id);
          pending.delete(id);
          emit({
            type: "tool.result",
            at,
            turn: turns,
            id,
            name: call?.name ?? "tool",
            input: call?.input ?? {},
            ok: block.is_error !== true,
            output: toolOutput(block.content),
            durationMs: 0,
          });
        }
        lastAt = at;
        return;
      }
      if (msg.type === "result") {
        const ok = msg.subtype === "success" && msg.is_error !== true;
        const summary =
          typeof msg.result === "string" && msg.result.trim()
            ? msg.result.trim()
            : lastText || "Claude Code finished without a summary.";
        const cost = typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : 0;
        result = ok
          ? end("done", summary, cost)
          : end(
              String(msg.subtype) === "error_max_turns" ? "budget" : "error",
              "Claude Code stopped with an error.",
              cost,
              `${String(msg.subtype)}${typeof msg.result === "string" && msg.result ? `: ${msg.result}` : ""}`,
            );
      }
    }

    child.on("error", (e: NodeJS.ErrnoException) => {
      if (ended) return;
      if (opts.signal?.aborted) return resolve(end("cancelled", "Stopped by the user.", 0));
      const message =
        e.code === "ENOENT"
          ? "Claude Code isn't installed. Install it from https://code.claude.com and sign in."
          : e.message;
      resolve(end("error", "Couldn't start Claude Code.", 0, message));
    });
    child.on("close", (code) => {
      if (buffer.trim()) handle(buffer.trim());
      if (result) return resolve(result);
      if (ended) return;
      if (opts.signal?.aborted) return resolve(end("cancelled", "Stopped by the user.", 0));
      const detail = stderr.trim().split("\n").slice(-5).join("\n");
      resolve(
        end(
          "error",
          "Claude Code exited without finishing.",
          0,
          `exit code ${code ?? "unknown"}${detail ? `\n${detail}` : ""}`,
        ),
      );
    });
  });
}

function toolOutput(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) =>
        c && typeof c === "object" && "text" in c ? String((c as { text: unknown }).text) : "",
      )
      .filter(Boolean)
      .join("\n");
  }
  return "";
}
