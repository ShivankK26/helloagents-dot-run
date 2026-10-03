import { useState } from "react";
import type { ProjectActions, ProjectRecord } from "../../../shared/api";
import { errorText } from "../toast";
import { Icon } from "./Icons";

/** A project's commands: setup on new branches, checks that decide "done", and the dev server. */
export function ActionsDialog({
  project,
  actions,
  onClose,
  onSaved,
}: {
  project: ProjectRecord;
  actions: ProjectActions;
  onClose: () => void;
  onSaved: (a: ProjectActions) => void;
}) {
  const api = window.helloagents;
  const [setup, setSetup] = useState(actions.setup ?? "");
  const [checks, setChecks] = useState(actions.checks.join("\n"));
  const [dev, setDev] = useState(actions.dev?.command ?? "");
  const [url, setUrl] = useState(actions.dev?.url ?? "http://localhost:3000");
  const [sendBack, setSendBack] = useState(actions.sendBackFailures);
  const [error, setError] = useState<string>();

  const fill = (a: ProjectActions) => {
    setSetup(a.setup ?? "");
    setChecks(a.checks.join("\n"));
    setDev(a.dev?.command ?? "");
    setUrl(a.dev?.url ?? "http://localhost:3000");
    setSendBack(a.sendBackFailures);
  };

  async function save() {
    const next: ProjectActions = {
      setup: setup.trim() || null,
      checks: checks
        .split("\n")
        .map((c) => c.trim())
        .filter(Boolean),
      dev: dev.trim() ? { command: dev.trim(), url: url.trim() || "http://localhost:3000" } : null,
      sendBackFailures: sendBack,
    };
    try {
      await api.setProjectActions(project.id, next);
      onSaved(next);
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog actions-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="actions-title"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <header className="dialog-head">
          <div>
            <h2 id="actions-title">Actions for {project.name}</h2>
            <p>Commands helloagents runs for you on each run's branch.</p>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        <div className="dialog-body">
          <div className="field">
            <label htmlFor="act-checks">Checks</label>
            <textarea
              id="act-checks"
              className="mono-input"
              rows={3}
              value={checks}
              onChange={(e) => setChecks(e.target.value)}
              placeholder={"npm test\nnpm run typecheck"}
            />
            <span className="field-hint">
              One per line. A run is done when all of these pass, not when the agent says so.
            </span>
          </div>
          <label className="toggle-row">
            <span>
              Send failures back to the agent
              <small>
                If a check fails, the agent gets the output and tries again, up to twice.
              </small>
            </span>
            <input
              type="checkbox"
              className="switch"
              checked={sendBack}
              onChange={(e) => setSendBack(e.target.checked)}
            />
          </label>
          <div className="field">
            <label htmlFor="act-setup">Setup</label>
            <input
              id="act-setup"
              className="mono-input"
              value={setup}
              onChange={(e) => setSetup(e.target.value)}
              placeholder="pnpm install"
            />
            <span className="field-hint">
              Runs once on every new branch, before the agent starts.
            </span>
          </div>
          <div className="field-pair">
            <div className="field">
              <label htmlFor="act-dev">Dev server</label>
              <input
                id="act-dev"
                className="mono-input"
                value={dev}
                onChange={(e) => setDev(e.target.value)}
                placeholder="npm run dev"
              />
            </div>
            <div className="field">
              <label htmlFor="act-url">Opens</label>
              <input
                id="act-url"
                className="mono-input"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </div>
          </div>
          {error ? <p className="error-text">{error}</p> : null}
          <div className="dialog-actions">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() =>
                void api
                  .detectActions(project.id)
                  .then(fill, (e: unknown) => setError(errorText(e)))
              }
            >
              Detect again
            </button>
            <span className="grow" />
            <button type="button" className="btn" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save actions
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
