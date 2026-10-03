import { useCallback, useEffect, useState } from "react";
import type { ErrorListItem, ProjectRecord } from "../../../shared/api";
import { ago } from "../time";
import { Icon } from "./Icons";

/** Everything that went wrong across runs: failed commands and tests, and runs that couldn't finish. */
export function ErrorsPage({
  projects,
  onOpenTrace,
}: {
  projects: ProjectRecord[];
  onOpenTrace: (runId: string) => void;
}) {
  const api = window.helloagents;
  const [errors, setErrors] = useState<ErrorListItem[]>();
  const refresh = useCallback(() => api.listErrors().then(setErrors), [api]);
  useEffect(() => {
    void refresh();
    return api.onRunChanged(() => void refresh());
  }, [api, refresh]);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Errors</h1>
        <p className="muted">
          Failed commands and tests, and runs that couldn't finish, newest first.
        </p>
      </header>
      {errors && errors.length === 0 ? (
        <div className="page-empty">
          <Icon name="check" size={22} />
          <p>No errors. When a test or command fails, or a run can't finish, it shows up here.</p>
        </div>
      ) : (
        <ul className="error-list">
          {errors?.map((e, i) => (
            <li key={`${e.runId}-${i}`} className="error-card">
              <div className="error-top">
                <span className="error-icon">
                  <Icon name="alert" size={15} />
                </span>
                <div className="error-what">
                  <b className="mono">{e.title}</b>
                  <span className="muted small">
                    {e.runTitle} · {projects.find((p) => p.id === e.projectId)?.name ?? "CLI"} ·{" "}
                    {ago(e.at)}
                  </span>
                </div>
                <button className="btn" onClick={() => onOpenTrace(e.runId)}>
                  <Icon name="trace" size={14} /> Open trace
                </button>
              </div>
              {e.excerpt ? <pre>{e.excerpt}</pre> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
