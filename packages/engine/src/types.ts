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
      /** Commands the agent left running in the background (e.g. a big download). */
      type: "agent.background";
      at: number;
      tasks: Array<{ id: string; description: string }>;
    }
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

/** Commands a project defines. Checks decide when a run is really done. */
export interface ProjectActions {
  /** Runs once on every new branch before the agent starts, e.g. "pnpm install". */
  setup: string | null;
  /** Run after the agent finishes; all must pass. */
  checks: string[];
  /** A long-running dev server and the URL it serves. */
  dev: { command: string; url: string } | null;
  /** Send failing checks back to the agent automatically (at most twice). */
  sendBackFailures: boolean;
  /**
   * A Node.js bin folder put first on PATH for these commands. Set by
   * helloagents when the default Node was too old for the project's tools.
   */
  nodeBin?: string | null;
  /** Permission rules the user chose "Always allow" for, e.g. "Bash(xcodebuild:*)". */
  alwaysAllow?: string[];
}

export interface ProjectRecord {
  id: string;
  name: string;
  /** Absolute path to the git repository. */
  path: string;
  workerAgent: AgentId;
  plannerAgent: AgentId;
  createdAt: number;
  /** null until detected or set by the user. */
  actions: ProjectActions | null;
}

export type RunEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** How much an agent may do without asking. */
export type Access = "edits" | "full";

/** Choices made in the composer for one run. */
export interface RunSettings {
  /** A Claude model id or alias; empty means the agent's default. */
  model?: string;
  effort?: RunEffort;
  access?: Access;
  /** "branch": its own worktree (default). "checkout": the user's working copy. */
  workspace?: "branch" | "checkout";
  /** The branch or commit a new branch starts from. Default: the current branch. */
  base?: string;
  /** Branch the work came from, for merging back. Set by the app. */
  baseBranch?: string;
  /** Images attached to the task (absolute paths the agent can read). */
  attachments?: string[];
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
  settings: RunSettings;
}

export interface StoredEvent {
  seq: number;
  runId: string;
  /** Which agent emitted it. A single-agent run uses "main". */
  agentId: string;
  event: AgentEvent;
}
