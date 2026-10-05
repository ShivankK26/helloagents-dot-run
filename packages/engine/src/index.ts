export const ENGINE_VERSION = "0.1.0";

export { detectClaudeCode, runCommand } from "./environment";
export type { RunCommand } from "./environment";
export { loadShellPath, parseShellPath } from "./shell-path";
export type * from "./types";

export { runAgent } from "./harness/agent";
export type { AgentOptions, AgentResult } from "./harness/agent";
export { AnthropicModel, DEFAULT_MODEL, ScriptedModel, reply } from "./harness/model";
export type { Effort, ModelClient, ModelRequest } from "./harness/model";
export { costOf, priceFor } from "./harness/pricing";
export { DEFAULT_ALLOWED_COMMANDS, runTool, safeEnv, toolDefinitions } from "./harness/tools";
export { resolveInside } from "./harness/workspace";

export { TraceStore } from "./trace/store";
export type { RunRecord, RunStatus, StoredEvent } from "./trace/store";
export {
  describeToolCall,
  failureExcerpt,
  digestRun,
  firstParagraph,
  isCommandTool,
  testResultLine,
  toErrors,
  toLogLines,
  toolKind,
  toolPath,
  type RunDigest,
  type RunStage,
  type ToolKind,
} from "./trace/views";
export type { LogLevel, LogLine, RunError } from "./trace/views";

export {
  claudeArgs,
  DEFAULT_CLAUDE_TOOLS,
  LEAN_CLAUDE_TOOLS,
  runClaudeCode,
} from "./workers/claude-code";
export type { ClaudeCodeOptions, ClaudeCodeResult } from "./workers/claude-code";
export { detectAgents } from "./workers/detect";
export {
  cloneRepo,
  createWorktree,
  findChildRepos,
  git,
  isGitRepo,
  removeWorktree,
  worktreeDiff,
} from "./git/worktree";
export type { Worktree } from "./git/worktree";
export { RunManager } from "./runs/manager";
export type { RunManagerOptions } from "./runs/manager";
export {
  declaredPackageManager,
  detectActions,
  installedNodes,
  openPullRequest,
  whyItCouldNotStart,
  withPackageManager,
  runShell,
  startBackground,
  stopBackground,
  type CommandResult,
} from "./runs/actions";
export {
  commitAll,
  currentBranch,
  headCommit,
  listBranches,
  mergeInto,
  pushBranch,
} from "./git/worktree";
export type { ProjectInfo, ShipKind, ShipResult } from "./runs/manager";
export { isSlashTask, listSlashCommands, readClaudeInit, type SlashCommand } from "./workers/slash";
export { ATTACHMENTS_HEADER, withAttachments } from "./runs/manager";
