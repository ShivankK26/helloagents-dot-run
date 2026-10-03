import { useCallback, useEffect, useState } from "react";
import type { ProjectRecord, RunListItem } from "../../../shared/api";
import { agentName, type AgentOption } from "../agents";
import { ago } from "../time";
import { Icon } from "./Icons";
import { RunDetail } from "./RunDetail";
import { StatusDot } from "./Status";

export function ProjectView({
  project,
  options,
}: {
  project: ProjectRecord;
  options: AgentOption[];
}) {
  const api = window.helloagents;
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [selected, setSelected] = useState<string>();
  const [task, setTask] = useState("");
  const [starting, setStarting] = useState(false);
  const worker = options.find((o) => o.id === project.workerAgent);

  const refresh = useCallback(() => api.listRuns(project.id).then(setRuns), [api, project.id]);
  useEffect(() => {
    void refresh();
    return api.onRunChanged(() => void refresh());
  }, [api, refresh]);

  async function start() {
    const text = task.trim();
    if (!text || worker?.unavailable) return;
    setStarting(true);
    try {
      const id = await api.startRun(project.id, text);
      setTask("");
      setSelected(id);
      await refresh();
    } finally {
      setStarting(false);
    }
  }

  return (
    <div className="project">
      <header className="project-head">
        <div>
          <h1>{project.name}</h1>
          <button className="path-btn mono" onClick={() => void api.revealInFinder(project.path)}>
            {project.path.replace(/^\/Users\/[^/]+/, "~")}
          </button>
        </div>
        <span className="agent-chip">{agentName(project.workerAgent)}</span>
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
          placeholder={`Describe a task for ${agentName(project.workerAgent)}…`}
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
          <span className="muted">
            {worker?.unavailable
              ? `${worker.name} is ${worker.unavailable}. Change the agent in this project's settings.`
              : `Runs on its own branch · ${worker?.billing ?? ""}`}
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

      <div className={`runs-area ${selected ? "has-selection" : ""}`}>
        <section className="runs" aria-label="Runs">
          <h2 className="section-label">Runs</h2>
          {runs.length === 0 ? (
            <p className="empty">No runs yet. Describe a task above and press Run.</p>
          ) : (
            <ul>
              {runs.map((r) => {
                const status = r.active ? "running" : r.status;
                return (
                  <li key={r.id}>
                    <button
                      className="run-row"
                      aria-current={selected === r.id}
                      onClick={() => setSelected(r.id)}
                    >
                      <StatusDot status={status} />
                      <span className="run-row-title">{r.title}</span>
                      <span className="run-row-when mono">
                        {r.active ? "now" : ago(r.startedAt)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        {selected ? (
          <RunDetail key={selected} runId={selected} onBack={() => setSelected(undefined)} />
        ) : runs.length ? (
          <div className="run-detail placeholder">
            <p className="empty">
              <Icon name="branch" /> Pick a run to see what the agent did.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
