import { execFile } from "node:child_process";
import type { ClaudeCodeStatus } from "./types";

/** Runs a command and resolves with stdout. Injectable so tests never spawn processes. */
export type RunCommand = (
  command: string,
  args: string[],
  options: { timeoutMs: number },
) => Promise<{ stdout: string }>;

export const runCommand: RunCommand = (command, args, { timeoutMs }) =>
  new Promise((resolve, reject) => {
    execFile(command, args, { timeout: timeoutMs }, (error, stdout) => {
      if (error) reject(error);
      else resolve({ stdout });
    });
  });

/**
 * Checks for the `claude` CLI. Claude Code workers run through it and use the
 * user's own Claude plan, so the app needs to know up front whether it's there.
 */
export async function detectClaudeCode(run: RunCommand = runCommand): Promise<ClaudeCodeStatus> {
  try {
    const { stdout } = await run("claude", ["--version"], { timeoutMs: 5000 });
    const version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
    return version ? { installed: true, version } : { installed: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return {
      installed: false,
      problem:
        code === "ENOENT"
          ? "Claude Code isn't installed. Install it from https://code.claude.com, then reopen helloagents."
          : "Claude Code is installed but didn't respond. Try running `claude --version` in a terminal.",
    };
  }
}
