import type { AgentProvider, ProjectRecord } from "../../../shared/api";
import { Icon } from "./Icons";

export type View = "runs" | "traces" | "errors" | "evals";

const SECTIONS: Array<{ id: View; label: string; icon: "runs" | "trace" | "alert" | "gauge" }> = [
  { id: "runs", label: "Runs", icon: "runs" },
  { id: "traces", label: "Traces", icon: "trace" },
  { id: "errors", label: "Errors", icon: "alert" },
  { id: "evals", label: "Evals", icon: "gauge" },
];

export function Sidebar({
  view,
  onView,
  errorCount,
  projects,
  selected,
  agents,
  onSelect,
  onAdd,
}: {
  view: View;
  onView: (view: View) => void;
  errorCount: number;
  projects: ProjectRecord[];
  selected?: string;
  agents: AgentProvider[];
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <aside className="sidebar">
      <nav className="side-nav" aria-label="Sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className="nav-row"
            aria-current={view === s.id ? "page" : undefined}
            onClick={() => onView(s.id)}
          >
            <Icon name={s.icon} />
            <span>{s.label}</span>
            {s.id === "errors" && errorCount ? (
              <span className="count bad">{errorCount}</span>
            ) : null}
            {s.id === "evals" ? <span className="soon mono">soon</span> : null}
          </button>
        ))}
      </nav>
      <div className="side-head">
        <h2 className="section-label">Projects</h2>
        <button
          className="icon-btn"
          onClick={onAdd}
          aria-label="Add a project"
          title="Add a project"
        >
          <Icon name="plus" />
        </button>
      </div>
      <ul className="project-list">
        {projects.map((p) => (
          <li key={p.id}>
            <button
              className="project-row"
              aria-current={view === "runs" && selected === p.id}
              onClick={() => onSelect(p.id)}
            >
              <Icon name="folder" /> <span>{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="side-foot">
        <h2 className="section-label">Agents</h2>
        {agents.map((a) => (
          <div key={a.id} className="agent-status" title={a.installed ? a.billing : a.installHint}>
            <span className={`dot ${a.installed ? "ok" : ""}`} />
            <span>{a.name}</span>
            <span className="mono muted">{a.installed ? (a.version ?? "") : "not installed"}</span>
          </div>
        ))}
      </div>
    </aside>
  );
}
