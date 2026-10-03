import { useCallback, useEffect, useState } from "react";
import type { ProjectRecord, RunListItem } from "../../../shared/api";
import { agentName } from "../agents";
import { compact, ms, tokenParts } from "../format";
import { ago } from "../time";
import { Icon } from "./Icons";
import { StatusDot } from "./Status";
import { TraceView } from "./TraceView";

/** Every run across projects, and the trace of the one you pick. */
export function TracesPage({
  projects,
  initialRunId,
}: {
  projects: ProjectRecord[];
  initialRunId?: string;
}) {
  const api = window.helloagents;
  const [runs, setRuns] = useState<RunListItem[]>();
  const [selected, setSelected] = useState(initialRunId);
  const refresh = useCallback(() => api.listAllRuns().then(setRuns), [api]);
  useEffect(() => {
    void refresh();
    return api.onRunChanged(() => void refresh());
  }, [api, refresh]);

  const projectOf = (r: RunListItem) => projects.find((p) => p.id === r.projectId);
  const current = runs?.find((r) => r.id === selected) ?? (selected ? undefined : runs?.[0]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Traces</h1>
        <p className="muted">
          Every step an agent took: each model turn and tool call, how long it took, and what it
          cost.
        </p>
      </header>
      {runs && runs.length === 0 ? (
        <div className="page-empty">
          <Icon name="trace" size={22} />
          <p>No runs yet. Start a task in a project and its trace shows up here.</p>
        </div>
      ) : (
        <div className={`split-page ${current ? "has-selection" : ""}`}>
          <ul className="list-col" aria-label="Runs">
            {runs?.map((r) => {
              const status = r.active ? "running" : r.status;
              return (
                <li key={r.id}>
                  <button
                    className="list-row"
                    aria-current={current?.id === r.id}
                    onClick={() => setSelected(r.id)}
                  >
                    <StatusDot status={status} />
                    <span className="list-main">
                      <span className="list-title">{r.title}</span>
                      <span className="list-meta mono">
                        {projectOf(r)?.name ?? "CLI"} · {r.agent ? agentName(r.agent) : "harness"} ·{" "}
                        {r.endedAt ? ms(r.endedAt - r.startedAt) : "running"} ·{" "}
                        {compact(tokenParts(r.usage).fresh)} tok
                      </span>
                    </span>
                    <span className="list-when mono">{r.active ? "now" : ago(r.startedAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {current ? (
            <TraceView key={current.id} runId={current.id} project={projectOf(current)} />
          ) : null}
        </div>
      )}
    </div>
  );
}
