import type { ClaudeCodeStatus } from "@helloagents/engine/types";

/** What the main process reports about this machine. */
export interface AppInfo {
  appVersion: string;
  engineVersion: string;
  electron: string;
  platform: string;
  claudeCode: ClaudeCodeStatus;
}

/**
 * Everything the window is allowed to ask the main process for. The preload
 * script exposes exactly this object as `window.helloagents`, nothing more.
 */
export interface HelloagentsApi {
  getInfo(): Promise<AppInfo>;
}

/** IPC channel names, shared so main and preload can't drift apart. */
export const IPC = {
  getInfo: "app:get-info",
} as const;
