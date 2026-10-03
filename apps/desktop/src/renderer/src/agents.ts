import type { AgentId, AgentProvider, AppInfo } from "../../shared/api";

export interface AgentOption {
  id: AgentId;
  name: string;
  billing: string;
  /** Why it can't be picked right now, if it can't. */
  unavailable?: string;
}

/** The agents a project can use, and whether each works on this machine. */
export function agentOptions(providers: AgentProvider[], info: AppInfo | undefined): AgentOption[] {
  const claude = providers.find((p) => p.id === "claude-code");
  const codex = providers.find((p) => p.id === "codex");
  return [
    {
      id: "claude-code",
      name: "Claude Code",
      billing: "your Claude plan",
      ...(!claude?.installed && { unavailable: "not installed" }),
    },
    {
      id: "codex",
      name: "Codex CLI",
      billing: "your ChatGPT plan",
      unavailable: codex?.installed ? "coming soon" : "not installed",
    },
    {
      id: "harness",
      name: "helloagents agent",
      billing: "your Anthropic API key",
      ...(!info?.hasApiKey && { unavailable: "needs ANTHROPIC_API_KEY" }),
    },
  ];
}

export const agentName = (id: AgentId) =>
  id === "claude-code" ? "Claude Code" : id === "codex" ? "Codex CLI" : "helloagents agent";
