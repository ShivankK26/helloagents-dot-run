import { spawn } from "node:child_process";
import type { AgentResult } from "../harness/agent";
import { addUsage, EMPTY_USAGE } from "../harness/pricing";
import type { Access, AgentEvent, AgentStatus, RunEffort, TokenUsage, ToolCall } from "../types";

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
  /** Model alias or id; omitted means Claude Code's default. */
  model?: string;
  effort?: RunEffort;
  /** "edits": edit freely, only listed commands. "full": no permission checks (still on its own branch). */
  access?: Access;
  /** Extra folders Claude Code may read, e.g. where attached images are saved. */
  addDirs?: readonly string[];
  /**
   * Asked when Claude Code wants to do something that isn't pre-approved, like
   * Claude Code's own permission prompt. Without it, such actions are denied.
   */
  onPermission?: (request: PermissionRequest) => Promise<PermissionDecision>;
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  /** Path to the claude executable (tests point this at a fake). */
  claudePath?: string;
  now?: () => number;
}

/** Claude Code wants to use a tool that needs the user's OK. */
export interface PermissionRequest {
  id: string;
  tool: string;
  input: unknown;
  /** What it wants to do, e.g. the command. */
  description: string;
  /** Why it needs approval, in Claude Code's words. */
  reason?: string;
  /** The rule "always allow" would add, e.g. "Bash(xcodebuild:*)". */
  rule?: string;
}

export type PermissionDecision =
  { behavior: "allow"; always?: boolean } | { behavior: "deny"; message?: string };

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
  opts: Pick<
    ClaudeCodeOptions,
    | "task"
    | "resumeSessionId"
    | "allowedTools"
    | "maxTurns"
    | "lean"
    | "model"
    | "effort"
    | "access"
    | "addDirs"
  > & { ask?: boolean },
): string[] {
  const args = [
    "-p",
    // When the app answers permission prompts, the task goes in over stdin instead.
    ...(opts.ask ? [] : [opts.task]),
    "--output-format",
    "stream-json",
    "--verbose",
    // File edits need no approval; other tools are limited to allowedTools.
    "--permission-mode",
    opts.access === "full" ? "bypassPermissions" : "acceptEdits",
    "--allowedTools",
    (opts.allowedTools ?? DEFAULT_CLAUDE_TOOLS).join(","),
    ...(opts.ask
      ? // Anything else is asked of helloagents over stdin/stdout, which asks the user.
        [
          "--input-format",
          "stream-json",
          "--permission-prompts",
          "host",
          "--permission-prompt-tool",
          "stdio",
        ]
      : // Nobody is there to answer a prompt: deny instead of waiting forever.
        ["--permission-prompts", "none"]),
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
      "--append-system-prompt",
      SHIPPING_NOTE,
    );
  }
  if (opts.addDirs?.length) args.push("--add-dir", ...opts.addDirs);
  if (opts.model) args.push("--model", opts.model);
  if (opts.effort) args.push("--effort", opts.effort);
  if (opts.maxTurns) args.push("--max-turns", String(opts.maxTurns));
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  return args;
}

/**
 * helloagents commits, pushes and opens pull requests itself (its Ship menu),
 * so the agent shouldn't try: in "edits" access those commands are blocked anyway.
 */
export const SHIPPING_NOTE =
  "You are running inside helloagents, on a branch of your own. Don't run git commit, git push, " +
  "or gh pr commands: helloagents does that itself. If the user asks you to commit, push, or open " +
  'a pull request, don\'t try; tell them to use the Ship button (or type "push" / "open a PR" ' +
  "in the follow-up box). Leave your changes uncommitted.";

/** What Claude Code prints when it doesn't know a flag (e.g. an older version). */
const REJECTED_FLAG = /unknown option|unknown argument|invalid option|error: option/i;

/**
 * Runs Claude Code headless (`claude -p`) on the user's own Claude plan and
 * translates its stream into the same events as the built-in harness, so
 * traces, logs and errors work identically for both.
 *
 * If a lean start is rejected before anything happens (an older Claude Code
 * that lacks one of the flags), it retries once with the normal setup.
 */
export async function runClaudeCode(opts: ClaudeCodeOptions): Promise<ClaudeCodeResult> {
  if (opts.lean === false) return runOnce(opts);
  let started = false;
  let heldEnd: AgentEvent | undefined;
  const result = await runOnce({
    ...opts,
    onEvent: (e) => {
      // Hold back an end that arrives before any work, in case we retry.
      if (!started && e.type === "agent.end") {
        heldEnd = e;
        return;
      }
      started = true;
      opts.onEvent?.(e);
    },
  });
  if (!started && result.status === "error" && REJECTED_FLAG.test(result.error ?? "")) {
    return runOnce({ ...opts, lean: false });
  }
  if (heldEnd) opts.onEvent?.(heldEnd);
  return result;
}

function runOnce(opts: ClaudeCodeOptions): Promise<ClaudeCodeResult> {
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
    const ask = Boolean(opts.onPermission) && opts.access !== "full";
    const child = spawn(opts.claudePath ?? "claude", claudeArgs({ ...opts, ask }), {
      cwd: opts.workspace,
      stdio: ["pipe", "pipe", "pipe"],
      signal: opts.signal,
    });
    const send = (message: unknown) => {
      if (child.stdin.writable) child.stdin.write(`${JSON.stringify(message)}\n`);
    };
    // Unanswered prompts would keep the process alive; stdin errors after exit are harmless.
    child.stdin.on("error", () => undefined);
    if (ask) send({ type: "user", message: { role: "user", content: opts.task } });
    // Without prompts, closing stdin stops Claude Code from waiting for piped input.
    else child.stdin.end();

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
      if (msg.type === "control_request") {
        void answerControl(msg);
        return;
      }
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
        child.stdin.end();
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

    /** Claude Code asks the app something; today, only "may I use this tool?". */
    async function answerControl(msg: Record<string, unknown>): Promise<void> {
      const requestId = String(msg.request_id);
      const req = (msg.request ?? {}) as Record<string, unknown>;
      if (req.subtype !== "can_use_tool" || !opts.onPermission) {
        send({
          type: "control_response",
          response: { subtype: "error", request_id: requestId, error: "Not supported" },
        });
        return;
      }
      const suggestions = Array.isArray(req.permission_suggestions)
        ? (req.permission_suggestions as Array<Record<string, unknown>>)
        : [];
      const rule = suggestedRule(String(req.tool_name), req.input, suggestions);
      // For a command, show the command itself; Claude's own description says what it's for.
      const command =
        req.tool_name === "Bash"
          ? (req.input as { command?: unknown } | undefined)?.command
          : undefined;
      const said = typeof req.description === "string" ? req.description : undefined;
      const decision = await opts
        .onPermission({
          id: String(req.tool_use_id ?? requestId),
          tool: String(req.tool_name),
          input: req.input,
          description: typeof command === "string" ? command : (said ?? String(req.tool_name)),
          ...(typeof command === "string" && said && said !== command
            ? { reason: said }
            : typeof req.decision_reason === "string" && { reason: req.decision_reason }),
          ...(rule && { rule }),
        })
        .catch((): PermissionDecision => ({ behavior: "deny", message: "No answer." }));
      send({
        type: "control_response",
        response: {
          subtype: "success",
          request_id: requestId,
          response:
            decision.behavior === "allow"
              ? {
                  behavior: "allow",
                  updatedInput: req.input,
                  // "Always": stop asking for this for the rest of the session too.
                  ...(decision.always &&
                    rule && {
                      updatedPermissions: [
                        {
                          type: "addRules",
                          rules: [ruleObject(rule)],
                          behavior: "allow",
                          destination: "session",
                        },
                      ],
                    }),
                }
              : { behavior: "deny", message: decision.message ?? "The user said no." },
        },
      });
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

/**
 * The rule "always allow" adds. For a shell command, its program
 * ("Bash(xcodebuild:*)"), like Claude Code's own "don't ask again for…".
 */
export function suggestedRule(
  tool: string,
  input: unknown,
  suggestions: Array<Record<string, unknown>> = [],
): string | undefined {
  if (tool === "Bash") {
    const command = String((input as { command?: unknown })?.command ?? "").trim();
    // The program that needed approval: skip "cd …" and env assignments, take the last
    // part of a chain (the one Claude Code flagged is usually the new one).
    const parts = command
      .split(/&&|\|\||;|\|/)
      .map((p) => p.trim().replace(/^(?:[A-Z_][A-Z0-9_]*=\S+\s+)+/, ""))
      .filter((p) => p && !/^cd\s/.test(p));
    const program = parts.at(-1)?.split(/\s+/)[0];
    return program && /^[\w./-]+$/.test(program) ? `Bash(${program}:*)` : undefined;
  }
  const first = (
    suggestions[0]?.rules as Array<{ toolName?: string; ruleContent?: string }> | undefined
  )?.[0];
  if (first?.toolName)
    return first.ruleContent ? `${first.toolName}(${first.ruleContent})` : first.toolName;
  return tool;
}

/** "Bash(xcodebuild:*)" → { toolName: "Bash", ruleContent: "xcodebuild:*" }. */
function ruleObject(rule: string): { toolName: string; ruleContent?: string } {
  const m = /^([^(]+)\((.*)\)$/.exec(rule);
  return m?.[1] ? { toolName: m[1], ruleContent: m[2] } : { toolName: rule };
}
