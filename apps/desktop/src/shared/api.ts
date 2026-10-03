import type {
  AgentId,
  AgentProvider,
  ClaudeCodeStatus,
  ProjectRecord,
  RunRecord,
  StoredEvent,
} from "@helloagents/engine/types";

export type { AgentId, AgentProvider, ProjectRecord, RunRecord, StoredEvent };

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

export interface RunListItem extends RunRecord {
  active: boolean;
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
  listRuns(projectId: string): Promise<RunListItem[]>;
  getRun(runId: string): Promise<RunListItem | null>;
  startRun(projectId: string, task: string): Promise<string>;
  cancelRun(runId: string): Promise<void>;
  discardRun(runId: string): Promise<void>;
  runEvents(runId: string, afterSeq: number): Promise<StoredEvent[]>;
  runDiff(runId: string): Promise<string>;
  revealInFinder(path: string): Promise<void>;
  /** Called with a run id whenever that run changes. Returns an unsubscribe function. */
  onRunChanged(listener: (runId: string) => void): () => void;
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
  listRuns: "runs:list",
  getRun: "runs:get",
  startRun: "runs:start",
  cancelRun: "runs:cancel",
  discardRun: "runs:discard",
  runEvents: "runs:events",
  runDiff: "runs:diff",
  revealInFinder: "shell:reveal",
  runChanged: "runs:changed",
} as const;
