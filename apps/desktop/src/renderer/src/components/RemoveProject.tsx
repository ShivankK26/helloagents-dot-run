import { useState } from "react";
import type { ProjectRecord, RunListItem } from "../../../shared/api";
import { errorText } from "../toast";

/** Asks before removing a project, and says exactly what goes and what stays. */
export function RemoveProject({
  project,
  runs,
  errorCount,
  onCancel,
  onRemoved,
}: {
  project: ProjectRecord;
  runs: RunListItem[];
  errorCount: number;
  onCancel: () => void;
  onRemoved: () => void;
}) {
  const api = window.helloagents;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const working = runs.filter((r) => r.active).length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  async function remove() {
    setBusy(true);
    setError(undefined);
    try {
      await api.removeProject(project.id);
      onRemoved();
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && !busy && onCancel()}>
      <div
        className="dialog remove-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="remove-title"
        onKeyDown={(e) => e.key === "Escape" && !busy && onCancel()}
      >
        <h2 id="remove-title">Remove “{project.name}”?</h2>
        <div className="lose">
          <span className="lose-h">You'll lose</span>
          <ul>
            <li>
              {runs.length ? `${plural(runs.length, "run")} and their activity` : "No runs yet"}
            </li>
            <li>
              {errorCount ? `Traces, logs and ${plural(errorCount, "error")}` : "Traces and logs"}
            </li>
            <li>Its saved checks and actions</li>
          </ul>
        </div>
        <p className="keep">
          Your folder <code>{project.path.replace(/^\/Users\/[^/]+/, "~")}</code> and its branches
          stay.
          {working ? ` ${plural(working, "run")} still working will be stopped.` : ""}
        </p>
        {error ? <p className="error-text">{error}</p> : null}
        <div className="dialog-actions">
          <button className="btn" onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </button>
          <button className="btn btn-danger" onClick={() => void remove()} disabled={busy}>
            {busy ? "Removing…" : working ? "Stop runs and remove" : "Remove"}
          </button>
        </div>
      </div>
    </div>
  );
}
