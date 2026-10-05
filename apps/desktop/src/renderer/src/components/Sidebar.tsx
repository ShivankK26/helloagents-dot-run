import { useState } from "react";
import type { AgentProvider, ProjectRecord, RunListItem } from "../../../shared/api";
import { outcomeOf } from "../outcome";
import { ago } from "../time";
import { Icon } from "./Icons";

export type Section = "overview" | "traces" | "errors" | "evals";
type Grouping = "status" | "project";

const GROUPING_KEY = "helloagents.sidebarGrouping";

const CLOSED_KEY = "helloagents.closedProjects";

function readClosed(): string[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(CLOSED_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function readGrouping(): Grouping {
  try {
    return localStorage.getItem(GROUPING_KEY) === "project" ? "project" : "status";
  } catch {
    return "status";
  }
}

/** Runs from every project, grouped by what needs you or by project, plus the app's sections. */
export function Sidebar({
  runs,
  projects,
  agents,
  errorCount,
  section,
  openRunId,
  currentProjectId,
  pinned,
  onTogglePin,
  onSection,
  onOpenRun,
  onOpenProject,
  onNewTask,
  onAddProject,
  onProjectMenu,
}: {
  runs: RunListItem[];
  projects: ProjectRecord[];
  agents: AgentProvider[];
  errorCount: number;
  section?: Section;
  openRunId?: string;
  currentProjectId?: string;
  pinned: boolean;
  onTogglePin: () => void;
  onSection: (s: Section) => void;
  onOpenRun: (runId: string) => void;
  onOpenProject: (projectId: string) => void;
  onNewTask: (projectId?: string) => void;
  onAddProject: () => void;
  onProjectMenu: (projectId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [grouping, setGrouping] = useState<Grouping>(readGrouping);
  const [closed, setClosed] = useState<string[]>(readClosed);
  const toggleProject = (id: string) => {
    const next = closed.includes(id) ? closed.filter((x) => x !== id) : [...closed, id];
    setClosed(next);
    try {
      localStorage.setItem(CLOSED_KEY, JSON.stringify(next));
    } catch {
      // not remembered
    }
  };
  const projectName = (id: string | null) => projects.find((p) => p.id === id)?.name ?? "";
  const q = query.trim().toLowerCase();
  const visible = runs.filter(
    (r) =>
      r.projectId &&
      (!q ||
        r.title.toLowerCase().includes(q) ||
        projectName(r.projectId).toLowerCase().includes(q)),
  );

  const setGroup = (g: Grouping) => {
    setGrouping(g);
    try {
      localStorage.setItem(GROUPING_KEY, g);
    } catch {
      // not remembered
    }
  };

  const row = (r: RunListItem, showProject: boolean) => {
    const o = outcomeOf(r);
    return (
      <button
        key={r.id}
        className="th"
        aria-current={openRunId === r.id ? "true" : undefined}
        onClick={() => onOpenRun(r.id)}
      >
        <i className={`dot ${o.tone}`} aria-hidden="true" />
        <span className="th-main">
          <b>{r.title}</b>
          <small className={o.tone}>
            {o.line}
            {showProject ? ` · ${projectName(r.projectId)}` : ""}
          </small>
        </span>
        <time>{r.active ? "now" : ago(r.startedAt).replace(" ago", "")}</time>
      </button>
    );
  };

  const needsYou = visible.filter((r) => r.approval || (!r.active && outcomeOf(r).tone === "bad"));
  const working = visible.filter((r) => r.active && !r.approval);
  const done = visible.filter((r) => !r.active && outcomeOf(r).tone !== "bad");
  const claude = agents.find((a) => a.id === "claude-code");

  return (
    <aside className={`sidebar ${pinned ? "pinned" : "floating"}`} aria-label="Sidebar">
      <div className="sb-top">
        <label className="sb-search">
          <Icon name="search" size={14} />
          <span className="sr">Search runs</span>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search runs"
          />
          <span className="kbd">⌘K</span>
        </label>
        <button
          className="icon-btn"
          onClick={() => onNewTask(currentProjectId)}
          title="New task (⌘N)"
          aria-label="New task"
        >
          <Icon name="edit" size={15} />
        </button>
      </div>

      <nav className="sb-nav" aria-label="Sections">
        {(
          [
            ["overview", "Overview", "layers", "⌘0"],
            ["traces", "Traces", "trace", ""],
            ["errors", "Errors", "alert", ""],
            ["evals", "Evals", "gauge", ""],
          ] as const
        ).map(([id, label, icon, key]) => (
          <button
            key={id}
            className="nv"
            aria-current={section === id ? "page" : undefined}
            onClick={() => onSection(id)}
          >
            <Icon name={icon} size={15} />
            <span>{label}</span>
            {id === "errors" && errorCount ? <span className="count bad">{errorCount}</span> : null}
            {id === "evals" ? <span className="soon">soon</span> : null}
            {key ? <span className="kbd">{key}</span> : null}
          </button>
        ))}
      </nav>

      <div className="segsm" role="group" aria-label="Group runs">
        <button aria-pressed={grouping === "status"} onClick={() => setGroup("status")}>
          By status
        </button>
        <button aria-pressed={grouping === "project"} onClick={() => setGroup("project")}>
          By project
        </button>
      </div>

      <div className="sb-body">
        {grouping === "status" ? (
          <>
            {needsYou.length ? (
              <Group label="Needs you" tone="warn" count={needsYou.length}>
                {needsYou.map((r) => row(r, true))}
              </Group>
            ) : null}
            {working.length ? (
              <Group label="Working" count={working.length}>
                {working.map((r) => row(r, true))}
              </Group>
            ) : null}
            {done.length ? (
              <Group label="Done" count={done.length}>
                {done.slice(0, 30).map((r) => row(r, true))}
              </Group>
            ) : null}
            {!visible.length ? (
              <p className="sb-empty">{q ? "No runs match." : "No runs yet. Start a task."}</p>
            ) : null}
            <Group label="Projects">
              {projects.map((p, i) => (
                <button
                  key={p.id}
                  className="pj"
                  aria-current={
                    currentProjectId === p.id && !openRunId && !section ? "true" : undefined
                  }
                  onClick={() => onOpenProject(p.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onProjectMenu(p.id);
                  }}
                >
                  <Icon name="folder" size={14} />
                  <span>{p.name}</span>
                  {i < 9 ? <span className="kbd">⌘{i + 1}</span> : null}
                  <span
                    className="pj-more"
                    role="button"
                    tabIndex={0}
                    aria-label={`More for ${p.name}`}
                    title="More"
                    onClick={(e) => {
                      e.stopPropagation();
                      onProjectMenu(p.id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onProjectMenu(p.id);
                      }
                    }}
                  >
                    <Icon name="dots" size={14} />
                  </span>
                </button>
              ))}
              <button className="pj" onClick={onAddProject}>
                <Icon name="plus" size={14} />
                <span>Add a project</span>
              </button>
            </Group>
          </>
        ) : (
          <>
            {projects.map((p) => {
              const mine = visible.filter((r) => r.projectId === p.id);
              const open = !closed.includes(p.id);
              return (
                <div key={p.id} className="tree">
                  <div
                    className="tree-head"
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onProjectMenu(p.id);
                    }}
                  >
                    <button
                      className="tree-toggle"
                      aria-expanded={open}
                      aria-label={`${open ? "Collapse" : "Expand"} ${p.name}`}
                      onClick={() => toggleProject(p.id)}
                    >
                      <Icon name="chevronDown" size={12} />
                    </button>
                    <button
                      className="tree-name"
                      aria-current={
                        currentProjectId === p.id && !openRunId && !section ? "true" : undefined
                      }
                      onClick={() => onOpenProject(p.id)}
                      title={p.name}
                    >
                      {p.name}
                    </button>
                    <span className="tree-count">{mine.length}</span>
                    <button
                      className="tree-new"
                      onClick={() => onNewTask(p.id)}
                      title={`New task in ${p.name}`}
                      aria-label={`New task in ${p.name}`}
                    >
                      <Icon name="plus" size={13} />
                    </button>
                    <button
                      className="tree-new"
                      onClick={() => onProjectMenu(p.id)}
                      title="More"
                      aria-label={`More for ${p.name}`}
                    >
                      <Icon name="dots" size={13} />
                    </button>
                  </div>
                  {open ? (
                    <div className="tree-runs">
                      {mine.length ? (
                        mine.slice(0, 12).map((r) => {
                          const o = outcomeOf(r);
                          return (
                            <button
                              key={r.id}
                              className="tree-run"
                              aria-current={openRunId === r.id ? "true" : undefined}
                              onClick={() => onOpenRun(r.id)}
                              title={`${r.title} · ${o.line}`}
                            >
                              <i className={`dot ${o.tone}`} aria-hidden="true" />
                              <span>{r.title}</span>
                              <time>{r.active ? "now" : ago(r.startedAt).replace(" ago", "")}</time>
                            </button>
                          );
                        })
                      ) : (
                        <p className="tree-empty">
                          No runs yet ·{" "}
                          <button className="link-btn" onClick={() => onNewTask(p.id)}>
                            New task
                          </button>
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <button className="add-project" onClick={onAddProject}>
              <Icon name="plus" size={13} /> Add a project
            </button>
          </>
        )}
      </div>

      <div className="sb-foot">
        <button
          className="icon-btn"
          onClick={onTogglePin}
          title={`${pinned ? "Hide" : "Keep"} the sidebar (⌘B)`}
          aria-pressed={pinned}
          aria-label="Keep the sidebar open"
        >
          <Icon name="sidebar" size={15} />
        </button>
        <span className="agent" title={claude?.installed ? claude.billing : claude?.installHint}>
          <i className={`dot ${claude?.installed ? "ok" : ""}`} /> Claude Code{" "}
          {claude?.version ?? (claude ? "not installed" : "")}
        </span>
      </div>
    </aside>
  );
}

function Group({
  label,
  count,
  tone,
  children,
}: {
  label: string;
  count?: number;
  tone?: "warn";
  children: React.ReactNode;
}) {
  return (
    <section className="grp">
      <h2 className={`grp-h ${tone ?? ""}`}>
        <span>{label}</span>
        {count ? <span>{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}
