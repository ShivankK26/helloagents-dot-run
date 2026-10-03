import type { ProjectRecord, RunListItem } from "../../../shared/api";
import { outcomeOf, STAGES } from "../outcome";
import { ago, elapsed } from "../time";
import { Icon } from "./Icons";

/** Every project side by side: what's working, what needs you, what just finished. */
export function Overview({
  projects,
  runs,
  onOpenRun,
  onNewTask,
  onAddProject,
}: {
  projects: ProjectRecord[];
  runs: RunListItem[];
  onOpenRun: (runId: string) => void;
  onNewTask: (projectId: string) => void;
  onAddProject: () => void;
}) {
  const working = runs.filter((r) => r.active).length;
  const needs = runs.filter((r) => !r.active && outcomeOf(r).tone === "bad").length;
  return (
    <div className="overview">
      <header className="page-bar">
        <h1>Overview</h1>
        <span className="run-meta">
          {projects.length} project{projects.length === 1 ? "" : "s"} · {working} working · {needs}{" "}
          need
          {needs === 1 ? "s" : ""} you
        </span>
        <span className="grow" />
        <button className="btn" onClick={onAddProject}>
          <Icon name="plus" size={13} /> Add a project
        </button>
      </header>
      <div className="board">
        {projects.map((p) => {
          const mine = runs.filter((r) => r.projectId === p.id);
          const live = mine.filter((r) => r.active);
          const attention = mine
            .filter((r) => !r.active && outcomeOf(r).tone === "bad")
            .slice(0, 3);
          const recent = mine.filter((r) => !r.active && outcomeOf(r).tone !== "bad").slice(0, 4);
          return (
            <section key={p.id} className="bcol" aria-label={p.name}>
              <header className="bhead">
                <b>{p.name}</b>
                <small>
                  {p.actions?.checks.length
                    ? `checks: ${p.actions.checks.join(", ")}`
                    : "no checks yet"}
                </small>
              </header>
              <div className="bbody">
                {live.map((r) => {
                  const at = STAGES.findIndex((s) => s.id === r.digest.stage);
                  return (
                    <button key={r.id} className="bcard" onClick={() => onOpenRun(r.id)}>
                      <b>{r.title}</b>
                      <span className="stg" aria-hidden="true">
                        {STAGES.map((s, i) => (
                          <i key={s.id} className={i < at ? "d" : i === at ? "n" : ""} />
                        ))}
                      </span>
                      <small>
                        {outcomeOf(r).line} · {elapsed(r.startedAt, Date.now())}
                      </small>
                    </button>
                  );
                })}
                {attention.map((r) => (
                  <button key={r.id} className="bcard need" onClick={() => onOpenRun(r.id)}>
                    <b>{r.title}</b>
                    <small className="bad">{outcomeOf(r).line}</small>
                  </button>
                ))}
                {recent.length ? (
                  <div className="blist">
                    {recent.map((r) => (
                      <button key={r.id} onClick={() => onOpenRun(r.id)}>
                        <i className={`dot ${outcomeOf(r).tone}`} />
                        <span className="t">{r.title}</span>
                        <small>{ago(r.startedAt).replace(" ago", "")}</small>
                      </button>
                    ))}
                  </div>
                ) : null}
                {!mine.length ? <p className="empty">Nothing yet.</p> : null}
              </div>
              <footer className="bfoot">
                <button className="btn btn-ghost" onClick={() => onNewTask(p.id)}>
                  <Icon name="plus" size={13} /> New task in {p.name}
                </button>
              </footer>
            </section>
          );
        })}
      </div>
    </div>
  );
}
