import type {
  AgentId,
  AgentProvider,
  ClaudeCodeStatus,
  ProjectActions,
  ProjectRecord,
  RunRecord,
  RunSettings,
  StoredEvent,
} from "@helloagents/engine/types";
import type { RunDigest, RunError } from "@helloagents/engine/views";

export type {
  AgentId,
  AgentProvider,
  ProjectActions,
  ProjectRecord,
  RunRecord,
  RunSettings,
  StoredEvent,
};

/** What the main process reports about this machine. */
export interface AppInfo {
  appVersion: string;
  engineVersion: string;
  electron: string;
  platform: string;
  claudeCode: ClaudeCodeStatus;
  /** True when ANTHROPIC_API_KEY is set, so the built-in agent can run. */
  hasApiKey: boolean;
}

export interface FolderInfo {
  path: string;
  name: string;
  isRepo: boolean;
  hasCommits: boolean;
  /** Git repositories directly inside this folder, when it isn't one itself. */
  childRepos: Array<{ path: string; name: string }>;
}

/** What the project screen shows above the composer. */
export interface ProjectInfo {
  branch: string | null;
  head: string;
  branches: string[];
  actions: ProjectActions;
}

export type ProjectMenuChoice = "new" | "actions" | "reveal" | "remove";

export type ShipKind = "commit" | "push" | "pr" | "merge";

export interface ShipResult {
  message: string;
  url?: string;
}

/** An app that can open a folder: an editor, Finder, a terminal. */
export interface Opener {
  id: string;
  name: string;
}

/** A Claude Code slash command, skill or MCP connector, for the composer's "/" menu. */
export interface SlashCommand {
  name: string;
  description: string;
  kind: "skill" | "command" | "mcp";
}

export type ThemeMode = "light" | "dark" | "system";

/** Something the agent is waiting for the user to allow. */
export interface ApprovalRequest {
  id: string;
  tool: string;
  /** What it wants to do, e.g. the command. */
  description: string;
  reason?: string;
  /** What "Always allow" would add, e.g. "Bash(xcodebuild:*)". */
  rule?: string;
}

export type ApprovalAnswer = "allow" | "always" | "auto" | "deny";

export interface RunListItem extends RunRecord {
  active: boolean;
  /** Waiting for the user's OK. */
  approval?: ApprovalRequest;
  /** A dev server is running on this run's branch. */
  devRunning: boolean;
  /** The run had a branch, but its folder is gone (discarded or removed). */
  branchGone: boolean;
  /** Files read and changed, commands, the last test result and the current stage. */
  digest: RunDigest;
}

/** Something that went wrong in a run, with the run it belongs to. */
export interface ErrorListItem extends RunError {
  runId: string;
  runTitle: string;
  projectId: string | null;
}

/**
 * Everything the window is allowed to ask the main process for. The preload
 * script exposes exactly this object as `window.helloagents`, nothing more.
 */
export interface HelloagentsApi {
  getInfo(): Promise<AppInfo>;
  detectAgents(): Promise<AgentProvider[]>;
  chooseFolder(): Promise<string | null>;
  inspectFolder(path: string): Promise<FolderInfo>;
  /** Clones into a folder the user picks. Resolves with the new repo's path, or null if cancelled. */
  cloneRepo(url: string): Promise<string | null>;
  listProjects(): Promise<ProjectRecord[]>;
  addProject(input: {
    path: string;
    name: string;
    workerAgent: AgentId;
    plannerAgent: AgentId;
  }): Promise<ProjectRecord>;
  updateProjectAgents(
    id: string,
    agents: { workerAgent: AgentId; plannerAgent: AgentId },
  ): Promise<void>;
  removeProject(id: string): Promise<void>;
  /** Shows the project's right-click menu; resolves with what the user picked. */
  projectMenu(id: string): Promise<ProjectMenuChoice | null>;
  listRuns(projectId: string): Promise<RunListItem[]>;
  /** Recent runs across every project, newest first. */
  listAllRuns(limit?: number): Promise<RunListItem[]>;
  /** Errors from recent runs, newest first. */
  listErrors(limit?: number): Promise<ErrorListItem[]>;
  getRun(runId: string): Promise<RunListItem | null>;
  startRun(projectId: string, task: string, settings?: RunSettings): Promise<string>;
  projectInfo(projectId: string): Promise<ProjectInfo>;
  setProjectActions(projectId: string, actions: ProjectActions): Promise<void>;
  /** Reads setup, checks and dev server from the project's files again. */
  detectActions(projectId: string): Promise<ProjectActions>;
  resumeRun(runId: string): Promise<void>;
  runChecks(runId: string): Promise<void>;
  ship(runId: string, kind: ShipKind): Promise<ShipResult>;
  /** Where the run's project pushes to (null if not on GitHub yet) and a suggested repo. */
  remoteInfo(runId: string): Promise<{ url: string | null; suggestion: string }>;
  /** Connects the project to a GitHub repo, creating it (private) if it doesn't exist. */
  connectRemote(runId: string, repo: string): Promise<ShipResult>;
  /** An image the agent looked at, as a data URL (for screenshots in the feed). */
  readImage(path: string): Promise<string | null>;
  /** Starts the dev server on the run's branch and opens it in the browser. */
  startDev(runId: string): Promise<string>;
  stopDev(runId: string): Promise<void>;
  listOpeners(): Promise<Opener[]>;
  openIn(openerId: string, path: string): Promise<void>;
  setTheme(mode: ThemeMode): Promise<void>;
  /** Continues a finished run on the same branch (and Claude Code session). */
  followUp(runId: string, message: string, attachments?: string[]): Promise<void>;
  /** Claude Code's commands and skills in this project (cached after the first call). */
  listSlashCommands(projectId: string): Promise<SlashCommand[]>;
  /** Saves an attached image where the agent can read it; resolves with its path. */
  saveAttachment(name: string, bytes: Uint8Array): Promise<string>;
  cancelRun(runId: string): Promise<void>;
  answerApproval(runId: string, requestId: string, answer: ApprovalAnswer): Promise<void>;
  discardRun(runId: string): Promise<void>;
  runEvents(runId: string, afterSeq: number): Promise<StoredEvent[]>;
  runDiff(runId: string): Promise<string>;
  revealInFinder(path: string): Promise<void>;
  /** Opens an http(s) link in the default browser. */
  openExternal(url: string): Promise<void>;
  /** Called with a run id whenever that run changes. Returns an unsubscribe function. */
  onRunChanged(listener: (runId: string) => void): () => void;
  /** Called when a notification is clicked: show this run. */
  onOpenRun(listener: (runId: string) => void): () => void;
}

/** IPC channel names, shared so main and preload can't drift apart. */
export const IPC = {
  getInfo: "app:get-info",
  detectAgents: "agents:detect",
  chooseFolder: "dialog:choose-folder",
  inspectFolder: "folder:inspect",
  cloneRepo: "git:clone",
  listProjects: "projects:list",
  addProject: "projects:add",
  updateProjectAgents: "projects:update-agents",
  removeProject: "projects:remove",
  projectMenu: "projects:menu",
  listRuns: "runs:list",
  listAllRuns: "runs:list-all",
  listErrors: "runs:errors",
  getRun: "runs:get",
  startRun: "runs:start",
  projectInfo: "projects:info",
  setProjectActions: "projects:set-actions",
  detectActions: "projects:detect-actions",
  resumeRun: "runs:resume",
  runChecks: "runs:checks",
  ship: "runs:ship",
  remoteInfo: "runs:remote-info",
  connectRemote: "runs:connect-remote",
  readImage: "files:read-image",
  startDev: "runs:dev-start",
  stopDev: "runs:dev-stop",
  listOpeners: "openers:list",
  openIn: "openers:open",
  setTheme: "app:set-theme",
  followUp: "runs:follow-up",
  listSlashCommands: "projects:slash-commands",
  saveAttachment: "attachments:save",
  cancelRun: "runs:cancel",
  answerApproval: "runs:answer-approval",
  discardRun: "runs:discard",
  runEvents: "runs:events",
  runDiff: "runs:diff",
  revealInFinder: "shell:reveal",
  openExternal: "shell:open-external",
  runChanged: "runs:changed",
  openRun: "runs:open",
} as const;
