// Plain data types shared with the app window. This file must not import any
// Node modules: the window's code is checked and bundled as browser code.

export interface ClaudeCodeStatus {
  installed: boolean;
  /** e.g. "2.1.287" */
  version?: string;
  /** Why it isn't usable, in words a user can act on. */
  problem?: string;
}
