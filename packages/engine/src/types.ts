// Plain data types shared with the app window. This file must not import any
// Node modules: the window's code is checked and bundled as browser code.

export interface ClaudeCodeStatus {
  installed: boolean;
  /** e.g. "2.1.287" */
  version?: string;
  /** Why it isn't usable, in words a user can act on. */
  problem?: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Why an agent run stopped. */
export type AgentStatus =
  | "done" // the agent called finish (or ended its turn with an answer)
  | "budget" // hit the turn or cost limit
  | "refused" // the model declined the request
  | "context_full" // the conversation outgrew the context window
  | "cancelled" // the user stopped it
  | "error"; // something failed that the agent couldn't recover from

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** Everything an agent does, in order. Traces, logs and the UI are built from these. */
export type AgentEvent =
  | {
      type: "agent.start";
      at: number;
      task: string;
      model: string;
      workspace: string;
      /** Set by workers that keep a resumable session (Claude Code). */
      sessionId?: string;
    }
  | {
      type: "model.response";
      at: number;
      turn: number;
      durationMs: number;
      /** The model that actually answered (differs from the requested one after a fallback). */
      model: string;
      stopReason: string | null;
      text: string;
      toolCalls: ToolCall[];
      usage: TokenUsage;
      costUsd: number;
    }
  | {
      type: "tool.result";
      at: number;
      turn: number;
      id: string;
      name: string;
      input: unknown;
      ok: boolean;
      output: string;
      durationMs: number;
    }
  | {
      type: "agent.end";
      at: number;
      status: AgentStatus;
      summary: string;
      turns: number;
      usage: TokenUsage;
      costUsd: number;
      error?: string;
      sessionId?: string;
    };

/** Which agent does the work: a connected CLI, or the built-in harness (needs an API key). */
export type AgentId = "claude-code" | "codex" | "harness";

export interface ProjectRecord {
  id: string;
  name: string;
  /** Absolute path to the git repository. */
  path: string;
  workerAgent: AgentId;
  plannerAgent: AgentId;
  createdAt: number;
}

/** A coding-agent CLI the user can connect, detected on this machine. */
export interface AgentProvider {
  id: "claude-code" | "codex";
  name: string;
  installed: boolean;
  version?: string;
  /** How runs are paid for, in the user's words. */
  billing: string;
  installHint: string;
}

export type RunStatus = "running" | AgentStatus;

export interface RunRecord {
  id: string;
  title: string;
  workspace: string;
  model: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  costUsd: number;
  usage: TokenUsage;
  summary: string | null;
  error: string | null;
  projectId: string | null;
  agent: AgentId | null;
  worktree: { path: string; branch: string; base: string } | null;
}

export interface StoredEvent {
  seq: number;
  runId: string;
  /** Which agent emitted it. A single-agent run uses "main". */
  agentId: string;
  event: AgentEvent;
}
