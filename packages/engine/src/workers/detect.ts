import { runCommand, type RunCommand } from "../environment";
import type { AgentProvider } from "../types";

const PROVIDERS: Array<Omit<AgentProvider, "installed" | "version"> & { command: string }> = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    billing: "Uses your Claude Pro or Max plan",
    installHint: "Install from https://code.claude.com, then run `claude` once to sign in.",
  },
  {
    id: "codex",
    name: "Codex CLI",
    command: "codex",
    billing: "Uses your ChatGPT plan",
    installHint: "Install with `npm install -g @openai/codex`, then run `codex` once to sign in.",
  },
];

/** Which coding-agent CLIs are installed. Checked in parallel; a missing one is not an error. */
export async function detectAgents(run: RunCommand = runCommand): Promise<AgentProvider[]> {
  return Promise.all(
    PROVIDERS.map(async ({ command, ...p }) => {
      try {
        const { stdout } = await run(command, ["--version"], { timeoutMs: 5000 });
        const version = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
        return { ...p, installed: true, ...(version && { version }) };
      } catch {
        return { ...p, installed: false };
      }
    }),
  );
}
