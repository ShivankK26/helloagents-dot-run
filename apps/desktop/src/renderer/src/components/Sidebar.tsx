import type { AgentProvider, ProjectRecord } from "../../../shared/api";
import { Icon } from "./Icons";

export function Sidebar({
  projects,
  selected,
  agents,
  onSelect,
  onAdd,
}: {
  projects: ProjectRecord[];
  selected?: string;
  agents: AgentProvider[];
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <aside className="sidebar">
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
              aria-current={selected === p.id}
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
