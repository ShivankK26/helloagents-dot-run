import type { AgentProvider, ProjectRecord } from "../../../shared/api";
import { Icon } from "./Icons";

export type View = "runs" | "traces" | "errors" | "evals";

const SECTIONS: Array<{ id: View; label: string; icon: "runs" | "trace" | "alert" | "gauge" }> = [
  { id: "runs", label: "Runs", icon: "runs" },
  { id: "traces", label: "Traces", icon: "trace" },
  { id: "errors", label: "Errors", icon: "alert" },
  { id: "evals", label: "Evals", icon: "gauge" },
];

/**
 * A slim rail of icons that opens over the content while you hover it (or
 * tab into it). "Keep open" pins it at full width.
 */
export function Sidebar({
  pinned,
  onTogglePin,
  view,
  onView,
  errorCount,
  projects,
  selected,
  agents,
  onSelect,
  onAdd,
}: {
  pinned: boolean;
  onTogglePin: () => void;
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
    <div className={`rail-slot ${pinned ? "pinned" : ""}`}>
      <nav className="rail" aria-label="Sidebar">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className="r-row"
            aria-current={view === s.id ? "page" : undefined}
            onClick={() => onView(s.id)}
            title={s.label}
          >
            <Icon name={s.icon} />
            {s.id === "errors" && errorCount ? <i className="r-badge" aria-hidden="true" /> : null}
            <span className="r-text">{s.label}</span>
            {s.id === "errors" && errorCount ? (
              <small className="r-text">{errorCount}</small>
            ) : null}
            {s.id === "evals" ? <small className="r-text">soon</small> : null}
          </button>
        ))}

        <div className="r-sep" />
        <div className="r-label r-text">Projects</div>
        {projects.map((p) => (
          <button
            key={p.id}
            className="r-row"
            aria-current={view === "runs" && selected === p.id ? "true" : undefined}
            onClick={() => onSelect(p.id)}
            title={p.name}
          >
            <Icon name="folder" />
            <span className="r-text">{p.name}</span>
          </button>
        ))}
        <button className="r-row" onClick={onAdd} title="Add a project">
          <Icon name="plus" />
          <span className="r-text">Add a project</span>
        </button>

        <div className="r-foot">
          <button
            className="r-row"
            onClick={onTogglePin}
            aria-pressed={pinned}
            title={`${pinned ? "Let the sidebar close" : "Keep the sidebar open"} (⌘B)`}
          >
            <Icon name="pin" />
            <span className="r-text">{pinned ? "Let it close" : "Keep open"}</span>
            <small className="r-text">⌘B</small>
          </button>
          {agents.map((a) => (
            <div
              key={a.id}
              className="r-row r-agent"
              title={`${a.name}: ${a.installed ? a.billing : a.installHint}`}
            >
              <span className="r-dot">
                <i className={`dot ${a.installed ? "ok" : ""}`} />
              </span>
              <span className="r-text">{a.name}</span>
              <small className="r-text">{a.installed ? (a.version ?? "") : "not installed"}</small>
            </div>
          ))}
        </div>
      </nav>
    </div>
  );
}
