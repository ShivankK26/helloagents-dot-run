import { useEffect, useState } from "react";
import { dismissToast, subscribeToasts, type Toast } from "../toast";

export function Toasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => subscribeToasts(setToasts), []);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.tone}`}>
          <i className={`dot ${t.tone === "bad" ? "bad" : t.tone === "ok" ? "ok" : ""}`} />
          <span>{t.message}</span>
          {t.url ? (
            <button
              className="link-btn"
              onClick={() => void window.helloagents.openExternal(t.url ?? "")}
            >
              Open
            </button>
          ) : null}
          <button className="icon-btn sm" onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
