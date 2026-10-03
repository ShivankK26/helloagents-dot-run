import { useCallback, useEffect, useState } from "react";
import type { AgentId, ProjectRecord, RunListItem } from "../../../shared/api";
import { agentName, type AgentOption } from "../agents";
import { outcomeOf } from "../outcome";
import { ago } from "../time";

/** A project's starting point: one question, one box, and how recent runs ended. */
export function ProjectHome({
  project,
  options,
  onOpenRun,
  onAgentChange,
}: {
  project: ProjectRecord;
  options: AgentOption[];
  onOpenRun: (runId: string) => void;
  onAgentChange: (agent: AgentId) => void;
}) {
  const api = window.helloagents;
  const [runs, setRuns] = useState<RunListItem[]>();
  const [task, setTask] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const worker = options.find((o) => o.id === project.workerAgent);

  const refresh = useCallback(() => api.listRuns(project.id).then(setRuns), [api, project.id]);
  useEffect(() => {
    void refresh();
    return api.onRunChanged(() => void refresh());
  }, [api, refresh]);

  async function start() {
    const text = task.trim();
    if (!text || worker?.unavailable || starting) return;
    setStarting(true);
    setError(undefined);
    try {
      const id = await api.startRun(project.id, text);
      setTask("");
      onOpenRun(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="home">
      <header className="home-head">
        <button
          className="path-btn"
          onClick={() => void api.revealInFinder(project.path)}
          title="Show in Finder"
        >
          {project.path.replace(/^\/Users\/[^/]+/, "~")}
        </button>
        <h1>
          What should {agentName(project.workerAgent)} do in {project.name}?
        </h1>
      </header>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <label htmlFor="task" className="sr">
          Task
        </label>
        <textarea
          id="task"
          rows={3}
          placeholder="Describe a task, like you'd ask a teammate…"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void start();
            }
          }}
        />
        <div className="composer-foot">
          <label className="agent-pick">
            <span className="sr">Agent</span>
            <select
              value={project.workerAgent}
              onChange={(e) => onAgentChange(e.target.value as AgentId)}
            >
              {options.map((o) => (
                <option key={o.id} value={o.id} disabled={Boolean(o.unavailable)}>
                  {o.name}
                  {o.unavailable ? ` (${o.unavailable})` : ""}
                </option>
              ))}
            </select>
          </label>
          <span className="hint">
            {worker?.unavailable
              ? `${worker.name} is ${worker.unavailable}. Pick another agent.`
              : `Works on its own branch · ${worker?.billing ?? ""}`}
          </span>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={!task.trim() || starting || Boolean(worker?.unavailable)}
          >
            {starting ? "Starting…" : "Run"} <kbd>⌘↵</kbd>
          </button>
        </div>
      </form>
      {error ? <p className="error-text">{error}</p> : null}

      <section className="recent" aria-label="Recent runs">
        <h2 className="label">Recent runs</h2>
        {runs && runs.length === 0 ? (
          <p className="empty">No runs yet. Describe a task above and press Run.</p>
        ) : (
          <ul>
            {runs?.map((r) => {
              const o = outcomeOf(r);
              return (
                <li key={r.id}>
                  <button className="recent-row" onClick={() => onOpenRun(r.id)}>
                    <i className={`dot ${o.tone}`} aria-hidden="true" />
                    <span className="recent-main">
                      <b>{r.title}</b>
                      <small className={o.tone}>{o.line}</small>
                    </span>
                    <time>{r.active ? "now" : ago(r.startedAt)}</time>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
