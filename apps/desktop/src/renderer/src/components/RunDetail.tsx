import { describeToolCall, toErrors } from "@helloagents/engine/views";
import { useCallback, useEffect, useRef, useState } from "react";
import type { RunListItem, StoredEvent } from "../../../shared/api";
import { agentName } from "../agents";
import { compact, tokenParts } from "../format";
import { elapsed } from "../time";
import { Markdown } from "./Markdown";
import { Diff } from "./Diff";
import { Icon } from "./Icons";
import { StatusPill } from "./Status";

type Tab = "activity" | "changes" | "summary";

export function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const api = window.helloagents;
  const [run, setRun] = useState<RunListItem | null>(null);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [diff, setDiff] = useState("");
  const [tab, setTab] = useState<Tab>("activity");
  const [now, setNow] = useState(() => Date.now());
  const lastSeq = useRef(0);
  const bottom = useRef<HTMLDivElement>(null);

  const refresh = useCallback(
    () =>
      Promise.all([api.getRun(runId), api.runEvents(runId, lastSeq.current)]).then(([r, fresh]) => {
        setRun(r);
        const last = fresh.at(-1);
        if (!last) return;
        lastSeq.current = last.seq;
        setEvents((prev) => [...prev, ...fresh]);
      }),
    [api, runId],
  );

  useEffect(() => {
    void refresh();
    return api.onRunChanged((id) => id === runId && void refresh());
  }, [api, runId, refresh]);

  useEffect(() => {
    if (!run?.active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [run?.active]);

  useEffect(() => {
    if (tab === "changes") void api.runDiff(runId).then(setDiff);
  }, [api, runId, tab, run?.status, events.length]);

  useEffect(() => {
    if (tab === "activity" && run?.active) bottom.current?.scrollIntoView({ block: "end" });
  }, [events.length, tab, run?.active]);

  if (!run)
    return (
      <div className="run-detail">
        <p className="empty">Loading…</p>
      </div>
    );

  const worktree = run.worktree;
  const status = run.active ? "running" : run.status;
  const errors = toErrors(events);
  // Claude Code's final message is also the run summary; don't show it twice.
  const lastSaid = events
    .map(({ event: e }) => (e.type === "model.response" ? e.text.trim() : ""))
    .filter(Boolean)
    .at(-1);
  const u = run.usage;
  const tokens = tokenParts(u);

  return (
    <div className="run-detail">
      <header className="run-head">
        <button className="icon-btn only-narrow" onClick={onBack} aria-label="Back to runs">
          <Icon name="back" />
        </button>
        <div className="run-title">
          <h2>{run.title}</h2>
          <div className="run-meta mono">
            <StatusPill status={status} />
            <span>{run.agent ? agentName(run.agent) : run.model}</span>
            <span>{elapsed(run.startedAt, run.endedAt ?? now)}</span>
            {tokens.fresh ? (
              <span title="New tokens: input, output and cache writes. Cache re-reads are counted separately.">
                {compact(tokens.fresh)} tokens
                {tokens.cached ? ` · ${compact(tokens.cached)} cached` : ""}
              </span>
            ) : null}
            {run.worktree ? (
              <span title={run.worktree.path}>
                <Icon name="branch" size={13} /> {run.worktree.branch}
              </span>
            ) : null}
          </div>
        </div>
        <div className="run-actions">
          {run.active ? (
            <button className="btn" onClick={() => void api.cancelRun(runId)}>
              <Icon name="stop" size={14} /> Stop
            </button>
          ) : worktree ? (
            <>
              <button className="btn" onClick={() => void api.revealInFinder(worktree.path)}>
                <Icon name="reveal" size={14} /> Open folder
              </button>
              <button
                className="btn"
                onClick={() => void api.discardRun(runId)}
                title="Delete this run's branch and folder"
              >
                <Icon name="trash" size={14} /> Discard
              </button>
            </>
          ) : null}
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {(["activity", "changes", "summary"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className="tab"
            onClick={() => setTab(t)}
          >
            {t === "activity" ? "Activity" : t === "changes" ? "Changes" : "Summary"}
            {t === "summary" && errors.length ? (
              <span className="count bad">{errors.length}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {tab === "activity" ? (
          <ol className="activity">
            {events.length === 0 ? (
              <li className="empty">
                {run.active ? "Starting the agent…" : (run.error ?? "No activity recorded.")}
              </li>
            ) : null}
            {events.map(({ seq, event: e }) => {
              if (e.type === "agent.start")
                return (
                  <li key={seq} className="act-note">
                    Started {agentName(run.agent ?? "claude-code")} on {e.model}
                  </li>
                );
              if (e.type === "model.response")
                return e.text ? (
                  <li key={seq} className="act-say">
                    <Markdown text={e.text} />
                  </li>
                ) : null;
              if (e.type === "tool.result") {
                return (
                  <li key={seq} className={`act-tool ${e.ok ? "" : "bad"}`}>
                    <details>
                      <summary>
                        <span className="mark">{e.ok ? "✓" : "✗"}</span>
                        <span className="mono">{describeToolCall(e.name, e.input)}</span>
                      </summary>
                      <pre>{e.output || "(no output)"}</pre>
                    </details>
                  </li>
                );
              }
              return (
                <li key={seq} className={`act-end ${e.status === "done" ? "ok" : "bad"}`}>
                  <b>
                    {e.status === "done"
                      ? "Finished"
                      : e.status === "cancelled"
                        ? "Stopped"
                        : "Didn't finish"}
                  </b>
                  {e.summary && e.summary.trim() !== lastSaid ? (
                    <Markdown text={e.summary} />
                  ) : null}
                  {e.error ? <pre>{e.error}</pre> : null}
                </li>
              );
            })}
            {run.active ? (
              <li className="act-note">
                <span className="spinner" /> Working…
              </li>
            ) : null}
            <div ref={bottom} />
          </ol>
        ) : null}

        {tab === "changes" ? <Diff diff={diff} /> : null}

        {tab === "summary" ? (
          <div className="summary">
            <h3>
              {run.active
                ? "Still working"
                : status === "done"
                  ? "What the agent did"
                  : "What happened"}
            </h3>
            {run.summary ? (
              <Markdown text={run.summary} />
            ) : (
              <p>{run.active ? "The summary appears when the agent finishes." : "No summary."}</p>
            )}
            {run.error ? <pre className="err">{run.error}</pre> : null}
            {errors.length ? <h3>Problems along the way</h3> : null}
            {errors.map((err, i) => (
              <div key={i} className="problem">
                <b>{err.title}</b>
                <pre>{err.excerpt}</pre>
              </div>
            ))}
            {run.worktree && !run.active ? (
              <p className="muted">
                The changes are on branch <code>{run.worktree.branch}</code>. Review them in
                Changes, then merge the branch the way you normally would.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
