import type { AgentProvider, AppInfo } from "../../../shared/api";
import { Logo } from "../Logo";
import { Icon } from "./Icons";

export function Welcome({
  agents,
  info,
  onAdd,
}: {
  agents: AgentProvider[];
  info?: AppInfo;
  onAdd: () => void;
}) {
  const ready = agents.some((a) => a.id === "claude-code" && a.installed) || info?.hasApiKey;
  return (
    <div className="welcome">
      <Logo size={44} />
      <h1>Welcome to helloagents</h1>
      <p className="muted">
        Hand a coding task to an agent. It works on its own branch, and you review the result.
      </p>

      <section className="welcome-card" aria-labelledby="agents-title">
        <h2 id="agents-title" className="section-label">
          Agents on this Mac
        </h2>
        <ul className="agent-list">
          {agents.map((a) => (
            <li key={a.id}>
              <span className={`mark ${a.installed ? "ok" : ""}`}>{a.installed ? "✓" : ""}</span>
              <span>
                <b>{a.name}</b>
                <small>
                  {a.installed
                    ? `${a.version ? `v${a.version} · ` : ""}${a.billing}`
                    : a.installHint}
                </small>
              </span>
              {a.id === "codex" && a.installed ? (
                <span className="pill muted">coming soon</span>
              ) : null}
            </li>
          ))}
          <li>
            <span className={`mark ${info?.hasApiKey ? "ok" : ""}`}>
              {info?.hasApiKey ? "✓" : ""}
            </span>
            <span>
              <b>helloagents agent</b>
              <small>
                {info?.hasApiKey
                  ? "Claude API key found"
                  : "Optional. Set ANTHROPIC_API_KEY to use the built-in agent."}
              </small>
            </span>
          </li>
        </ul>
      </section>

      <button className="btn btn-primary btn-lg" onClick={onAdd} disabled={!ready}>
        <Icon name="plus" /> Add a project
      </button>
      {!ready ? (
        <p className="muted small">Install Claude Code (or set an API key) to get started.</p>
      ) : null}
    </div>
  );
}
