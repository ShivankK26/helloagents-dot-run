import { describeToolCall, toLogLines } from "@helloagents/engine/views";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectRecord, RunListItem, StoredEvent } from "../../../shared/api";
import { agentName } from "../agents";
import { compact, ms, tokenParts } from "../format";
import { outcomeOf } from "../outcome";
import { Markdown } from "./Markdown";

type Step = Extract<StoredEvent["event"], { type: "model.response" | "tool.result" }>;

/** A time offset into the run: seconds for short runs, m:ss for longer ones. */
const offset = (n: number, total: number) =>
  total < 60_000
    ? `${(n / 1000).toFixed(total < 10_000 ? 2 : 1)}s`
    : `${Math.floor(n / 60_000)}:${String(Math.floor((n % 60_000) / 1000)).padStart(2, "0")}`;

/** One run's trace: a timeline of every model turn and tool call, and its log. */
export function TraceView({
  runId,
  project,
  embedded = false,
}: {
  runId: string;
  project?: ProjectRecord;
  /** Inside a run's Trace tab: no title header, the run screen already shows it. */
  embedded?: boolean;
}) {
  const api = window.helloagents;
  const [run, setRun] = useState<RunListItem | null>(null);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [mode, setMode] = useState<"timeline" | "logs">("timeline");
  const [open, setOpen] = useState<number>();
  const [now, setNow] = useState(() => Date.now());
  const lastSeq = useRef(0);

  const refresh = useCallback(
    () =>
      Promise.all([api.getRun(runId), api.runEvents(runId, lastSeq.current)]).then(([r, fresh]) => {
        setRun(r);
        const last = fresh.at(-1);
        if (!last) return;
        lastSeq.current = last.seq;
        // Two refreshes can overlap (and React runs effects twice in development); keep each event once.
        setEvents((prev) => {
          const seen = prev.at(-1)?.seq ?? 0;
          return [...prev, ...fresh.filter((e) => e.seq > seen)];
        });
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

  if (!run)
    return (
      <div className={`trace ${embedded ? "embedded" : ""}`}>
        <p className="empty">Loading…</p>
      </div>
    );

  const start = run.startedAt;
  const total = Math.max((run.endedAt ?? now) - start, 1);
  const steps = events.filter(
    (s): s is StoredEvent & { event: Step } =>
      s.event.type === "model.response" || s.event.type === "tool.result",
  );
  const tools = steps.filter((s) => s.event.type === "tool.result");
  const failed = tools.filter((s) => s.event.type === "tool.result" && !s.event.ok).length;
  const turns = steps.filter((s) => s.event.type === "model.response").length;
  const tokens = tokenParts(run.usage);
  const outcome = outcomeOf(run);

  return (
    <div className={`trace ${embedded ? "embedded" : ""}`}>
      {embedded ? null : (
        <header className="trace-head">
          <div className="trace-title">
            <h2>{run.title}</h2>
            <div className="run-meta mono">
              <span className={`pill ${outcome.tone}`}>{outcome.label}</span>
              {project ? <span>{project.name}</span> : null}
              <span>{run.agent ? agentName(run.agent) : run.model}</span>
              <span>{new Date(start).toLocaleString()}</span>
            </div>
          </div>
        </header>
      )}

      <dl className="stats">
        <div>
          <dt>Duration</dt>
          <dd>{ms(total)}</dd>
        </div>
        <div>
          <dt>Model turns</dt>
          <dd>{turns}</dd>
        </div>
        <div>
          <dt>Tool calls</dt>
          <dd>
            {tools.length}
            {failed ? <small className="bad"> · {failed} failed</small> : null}
          </dd>
        </div>
        <div title="Input, output and cache writes">
          <dt>New tokens</dt>
          <dd>{compact(tokens.fresh)}</dd>
        </div>
        <div title="The conversation re-read from cache on each turn">
          <dt>Cached</dt>
          <dd>{compact(tokens.cached)}</dd>
        </div>
        <div title="What this run would cost at Claude API prices. On a Claude plan it counts toward your usage limits instead.">
          <dt>API cost</dt>
          <dd>${run.costUsd.toFixed(2)}</dd>
        </div>
      </dl>

      <nav className="tabs" role="tablist">
        {(["timeline", "logs"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className="tab"
            onClick={() => setMode(m)}
          >
            {m === "timeline" ? "Timeline" : "Logs"}
          </button>
        ))}
      </nav>

      <div className="tab-body">
        {mode === "timeline" ? (
          steps.length === 0 ? (
            <p className="empty">
              {run.active ? "Waiting for the first step…" : "Nothing was recorded for this run."}
            </p>
          ) : (
            <ol className="waterfall">
              <li className="wf-axis" aria-hidden="true">
                <span />
                <span className="wf-ticks">
                  {[0, 0.25, 0.5, 0.75, 1].map((f) => (
                    <i key={f} style={{ left: `${f * 100}%` }}>
                      {offset(total * f, total)}
                    </i>
                  ))}
                </span>
                <span />
              </li>
              {steps.map(({ seq, event: e }) => {
                const begin = Math.max(e.at - e.durationMs - start, 0);
                const left = Math.min((begin / total) * 100, 99.4);
                const width = Math.max(Math.min((e.durationMs / total) * 100, 100 - left), 0.6);
                const isModel = e.type === "model.response";
                const tone = isModel ? "model" : e.ok ? "ok" : "bad";
                const label = isModel
                  ? `Model · turn ${e.turn}`
                  : describeToolCall(e.name, e.input);
                const u = isModel ? tokenParts(e.usage) : null;
                return (
                  <li key={seq} className={`wf-row ${open === seq ? "open" : ""}`}>
                    <button
                      className="wf-line"
                      onClick={() => setOpen(open === seq ? undefined : seq)}
                      aria-expanded={open === seq}
                    >
                      <span className={`wf-label ${tone}`}>
                        <i className={`wf-kind ${tone}`}>{isModel ? "M" : e.ok ? "T" : "!"}</i>
                        <span className="mono">{label}</span>
                      </span>
                      <span className="wf-track">
                        <span
                          className={`wf-bar ${tone}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                        />
                      </span>
                      <span className="wf-num mono">
                        {ms(e.durationMs)}
                        {u ? <small> · {compact(u.fresh)}</small> : null}
                      </span>
                    </button>
                    {open === seq ? (
                      <div className="wf-detail">
                        {e.type === "model.response" ? (
                          <>
                            <dl className="kv mono">
                              <div>
                                <dt>Model</dt>
                                <dd>{e.model}</dd>
                              </div>
                              <div>
                                <dt>Input</dt>
                                <dd>{e.usage.inputTokens.toLocaleString()}</dd>
                              </div>
                              <div>
                                <dt>Output</dt>
                                <dd>{e.usage.outputTokens.toLocaleString()}</dd>
                              </div>
                              <div>
                                <dt>Cache read</dt>
                                <dd>{e.usage.cacheReadTokens.toLocaleString()}</dd>
                              </div>
                              <div>
                                <dt>Cache write</dt>
                                <dd>{e.usage.cacheWriteTokens.toLocaleString()}</dd>
                              </div>
                              <div>
                                <dt>Stop</dt>
                                <dd>{e.stopReason ?? "tool use"}</dd>
                              </div>
                            </dl>
                            {e.text ? <Markdown text={e.text} /> : null}
                            {e.toolCalls.length ? (
                              <p className="muted small">
                                Asked for:{" "}
                                {e.toolCalls
                                  .map((c) => describeToolCall(c.name, c.input))
                                  .join(", ")}
                              </p>
                            ) : null}
                          </>
                        ) : (
                          <>
                            <h4>Input</h4>
                            <pre>{JSON.stringify(e.input, null, 2)}</pre>
                            <h4>Output</h4>
                            <pre className={e.ok ? "" : "err"}>{e.output || "(no output)"}</pre>
                          </>
                        )}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )
        ) : (
          <ol className="logs mono">
            {toLogLines(events).map((l, i) => (
              <li key={i} className={l.level.toLowerCase()}>
                <span className="log-at">{offset(Math.max(l.at - start, 0), total)}</span>
                <span className="log-level">{l.level}</span>
                <span className="log-msg">{l.message}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
