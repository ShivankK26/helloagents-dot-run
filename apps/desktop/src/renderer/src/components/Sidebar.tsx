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
  collapsed,
  view,
  onView,
  errorCount,
  projects,
  selected,
  agents,
  onSelect,
  onAdd,
}: {
  /** Icons only: a narrow rail that leaves more room for the work. */
  collapsed: boolean;
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
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <nav className="side-nav" aria-label="Sections">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className="nav-row"
            aria-current={view === s.id ? "page" : undefined}
            onClick={() => onView(s.id)}
            title={collapsed ? s.label : undefined}
            aria-label={collapsed ? s.label : undefined}
          >
            <Icon name={s.icon} />
            <span className="side-text">{s.label}</span>
            {s.id === "errors" && errorCount ? (
              <span className="count bad">{errorCount}</span>
            ) : null}
            {s.id === "evals" ? <span className="soon mono side-text">soon</span> : null}
          </button>
        ))}
      </nav>
      <div className="side-head">
        <h2 className="section-label side-text">Projects</h2>
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
              title={collapsed ? p.name : undefined}
              aria-label={collapsed ? p.name : undefined}
            >
              <Icon name="folder" /> <span className="side-text">{p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="side-foot">
        <h2 className="section-label side-text">Agents</h2>
        {agents.map((a) => (
          <div
            key={a.id}
            className="agent-status"
            title={`${a.name}: ${a.installed ? a.billing : a.installHint}`}
          >
            <span className={`dot ${a.installed ? "ok" : ""}`} />
            <span className="side-text">{a.name}</span>
            <span className="mono muted side-text">
              {a.installed ? (a.version ?? "") : "not installed"}
            </span>
          </div>
        ))}
      </div>
    </aside>
  );
}
