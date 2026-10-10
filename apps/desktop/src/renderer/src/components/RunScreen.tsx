import { toErrors, toolKind, isCommandTool } from "@helloagents/engine/views";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Opener,
  ProjectRecord,
  RunListItem,
  ShipKind,
  StoredEvent,
} from "../../../shared/api";
import { agentName } from "../agents";
import { compact, ms, tokenParts } from "../format";
import { outcomeOf, STAGES } from "../outcome";
import { shipIntent, whereIsCode } from "../ship";
import { elapsed } from "../time";
import { ActivityFeed } from "./ActivityFeed";
import { ChangesView } from "./ChangesView";
import { AttachButton, AttachmentStrip, DropOverlay, useAttachments } from "./Attachments";
import { useGrowBox } from "./Grow";
import { Icon } from "./Icons";
import { useSlashMenu } from "./SlashMenu";
import { loadDraft, saveDraft } from "../drafts";
import { errorText, showToast } from "../toast";
import { Menu } from "./Menu";
import { TraceView } from "./TraceView";

export type RunTab = "activity" | "changes" | "trace";

/** One run, using the whole window: what the agent is doing, how it went, and every detail. */
export function RunScreen({
  runId,
  project,
  initialTab = "activity",
  openers,
  onBack,
  onOpenRun,
}: {
  runId: string;
  project: ProjectRecord;
  initialTab?: RunTab;
  openers: Opener[];
  onBack: () => void;
  onOpenRun: (runId: string) => void;
}) {
  const api = window.helloagents;
  const [run, setRun] = useState<RunListItem | null>(null);
  const [events, setEvents] = useState<StoredEvent[]>([]);
  const [tab, setTab] = useState<RunTab>(initialTab);
  const [diff, setDiff] = useState("");
  const [diffLoaded, setDiffLoaded] = useState(false);
  const [diffError, setDiffError] = useState<string>();
  const [now, setNow] = useState(() => Date.now());
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [shipping, setShipping] = useState<ShipKind>();
  const lastSeq = useRef(0);
  const feedEnd = useRef<HTMLDivElement>(null);

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

  useEffect(() => {
    if (tab !== "changes") return;
    void api.runDiff(runId).then(
      (d) => {
        setDiff(d);
        setDiffError(undefined);
        setDiffLoaded(true);
      },
      (e: unknown) => {
        setDiffError(errorText(e));
        setDiffLoaded(true);
      },
    );
  }, [api, runId, tab, run?.status, run?.digest.filesChanged.length]);

  // The feed opens at the newest step and follows new ones (and images loading) while
  // you're at the bottom; scrolling up stops that until you scroll back down. It scrolls
  // only the feed itself: scrollIntoView would also scroll every container around it,
  // including a web page embedding the app.
  const stick = useRef(true);
  const hasRun = Boolean(run);
  const approvalId = run?.approval?.id;
  useEffect(() => {
    const feed = feedEnd.current?.closest<HTMLElement>(".feed");
    const inner = feed?.querySelector(".feed-inner");
    if (tab !== "activity" || !feed || !inner) return;
    stick.current = true;
    const toBottom = () => {
      if (stick.current) feed.scrollTop = feed.scrollHeight;
    };
    const onScroll = () => {
      stick.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 80;
    };
    toBottom();
    const grow = new ResizeObserver(toBottom);
    grow.observe(inner);
    feed.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      grow.disconnect();
      feed.removeEventListener("scroll", onScroll);
    };
  }, [tab, hasRun]);

  useEffect(() => {
    // A ship step or an approval card always comes into view.
    const feed = feedEnd.current?.closest(".feed");
    const shipped = events.at(-1)?.event;
    const justShipped = shipped?.type === "tool.result" && shipped.name === "ship";
    if (tab === "activity" && feed && (justShipped || approvalId)) {
      stick.current = true;
      feed.scrollTop = feed.scrollHeight;
    }
  }, [events, tab, approvalId]);

  // A push or PR on a project that isn't on GitHub yet first asks which repo.
  const [connect, setConnect] = useState<{ kind: ShipKind; suggestion: string }>();

  /** Commit, push, PR or merge, done by helloagents (the agent can't push). */
  const ship = useCallback(
    async (kind: ShipKind) => {
      setShipping(kind);
      try {
        if (kind === "push" && run && run.settings.workspace !== "checkout") {
          const opened =
            whereIsCode(events, run.settings.baseBranch ?? "main", true)?.label === "PR open";
          if (!opened) kind = "pr";
        }
        if (kind === "push" || kind === "pr") {
          const remote = await api.remoteInfo(runId);
          if (!remote.url) {
            setConnect({ kind, suggestion: remote.suggestion });
            return;
          }
        }
        const r = await api.ship(runId, kind);
        showToast(r.message, { tone: "ok", ...(r.url && { url: r.url }) });
      } catch (e) {
        showToast(errorText(e), { tone: "bad" });
      } finally {
        setShipping(undefined);
      }
    },
    [api, runId, run, events],
  );

  if (!run) return <div className="run-screen" />;

  const outcome = outcomeOf(run);
  const tokens = tokenParts(run.usage);
  const d = run.digest;
  const took = elapsed(run.startedAt, run.endedAt ?? now);
  const worktree = run.worktree;
  // You can type while it works; the agent reads it right away.
  const canFollowUp = Boolean(worktree);
  const inPlace = run.settings.workspace === "checkout";
  const base = run.settings.baseBranch ?? "main";
  const where = worktree ? whereIsCode(events, base, d.filesChanged.length > 0) : null;
  const prOpen = where?.label === "PR open";
  // One clear next step: a PR into the base branch (or merge straight in). With a PR
  // open, "push" sends new commits to it.
  const shipKinds: ShipKind[] =
    worktree && !run.branchGone && !run.active
      ? inPlace
        ? ["push"]
        : prOpen
          ? ["push"]
          : ["merge", "pr"]
      : [];

  async function discard() {
    await api.discardRun(runId);
    onBack();
  }

  return (
    <div className="run-screen">
      <header className="run-bar">
        <nav className="crumb" aria-label="Breadcrumb">
          <button
            className="icon-btn"
            onClick={onBack}
            title={`Back to ${project.name}`}
            aria-label={`Back to ${project.name}`}
          >
            <Icon name="back" size={14} />
          </button>
          <h1 title={run.title}>{run.title}</h1>
        </nav>
        <span className={`pill ${outcome.tone}`}>{outcome.label}</span>
        {where ? (
          where.url ? (
            <button
              className={`pill where ${where.tone}`}
              title="Open the pull request"
              onClick={() => where.url && void api.openExternal(where.url)}
            >
              <Icon name="pr" size={11} /> {where.label}
            </button>
          ) : (
            <span className={`pill where ${where.tone}`} title={`Branch ${worktree?.branch ?? ""}`}>
              <Icon name={where.tone === "muted" ? "branch" : "git"} size={11} /> {where.label}
            </span>
          )
        ) : null}
        <span className="run-meta">
          <span>{took}</span>
          {tokens.fresh ? (
            <span title="New tokens, then the conversation re-read from cache">
              {compact(tokens.fresh)} tokens
              {tokens.cached ? ` · ${compact(tokens.cached)} cached` : ""}
            </span>
          ) : null}
        </span>
        <RunActions
          onShip={(k) => void ship(k)}
          shipping={shipping}
          run={run}
          project={project}
          openers={openers}
          confirmDiscard={confirmDiscard}
          setConfirmDiscard={setConfirmDiscard}
          onDiscard={() => void discard()}
        />
      </header>

      {run.active ? (
        <ol className="stages" aria-label="Progress">
          {STAGES.map((s, i) => {
            const at = STAGES.findIndex((x) => x.id === d.stage);
            const state = i < at ? "done" : i === at ? "now" : "next";
            return (
              <li key={s.id} className={`stage ${state}`}>
                <i aria-hidden="true">{state === "done" ? "✓" : ""}</i>
                {s.label}
              </li>
            );
          })}
        </ol>
      ) : null}

      <nav className="tabs run-tabs" role="tablist">
        {(["activity", "changes", "trace"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className="tab"
            onClick={() => setTab(t)}
          >
            {t === "activity" ? "Activity" : t === "changes" ? "Changes" : "Trace"}
            {t === "changes" && d.filesChanged.length ? (
              <span className="count">{d.filesChanged.length}</span>
            ) : null}
          </button>
        ))}
      </nav>

      <div className="run-body">
        {tab === "activity" ? (
          <div className="activity-layout">
            <div className="feed">
              <div className="feed-inner">
                {!run.active ? (
                  <SummaryCard
                    run={run}
                    events={events}
                    took={took}
                    onReview={() => setTab("changes")}
                    onSendBack={(message) => void api.followUp(runId, message)}
                  />
                ) : null}
                {/* The answer shows in full, in the chat, as soon as it's written. */}
                <ActivityFeed
                  events={events}
                  active={run.active}
                  root={worktree?.path}
                  {...(run.approval && { approval: run.approval })}
                  mode={run.settings.access ?? "auto"}
                  onOpenRun={onOpenRun}
                  {...(connect && {
                    children: (
                      <ConnectCard
                        suggestion={connect.suggestion}
                        kind={connect.kind}
                        onCancel={() => setConnect(undefined)}
                        onConnect={async (repo) => {
                          await api.connectRemote(runId, repo);
                          const kind = connect.kind;
                          setConnect(undefined);
                          await ship(kind);
                        }}
                      />
                    ),
                  })}
                  onAnswer={(a) =>
                    run.approval &&
                    void api
                      .answerApproval(runId, run.approval.id, a)
                      .catch((e: unknown) => showToast(errorText(e), { tone: "bad" }))
                  }
                  shipKinds={shipKinds}
                  shipping={shipping}
                  onShip={(k) => void ship(k)}
                />
                <div ref={feedEnd} />
              </div>
            </div>
          </div>
        ) : null}
        {tab === "changes" ? (
          <ChangesView
            diff={diff}
            loading={!diffLoaded}
            {...(diffError && { error: diffError })}
            footer={
              <RunFacts run={run} events={events} took={took} onTrace={() => setTab("trace")} />
            }
          />
        ) : null}
        {tab === "trace" ? (
          <div className="trace-tab">
            <TraceView runId={runId} project={project} embedded />
          </div>
        ) : null}
      </div>

      {worktree && !run.branchGone ? (
        <Dock
          runId={runId}
          projectId={project.id}
          isClaude={(run.agent ?? "claude-code") === "claude-code"}
          enabled={canFollowUp}
          active={run.active}
          inPlace={inPlace}
          shipping={shipping}
          onShip={(k) => ship(k)}
        />
      ) : null}
    </div>
  );
}

/** A short summary: how it went and a few facts. The answer itself is in the chat below. */
function SummaryCard({
  run,
  events,
  took,
  onReview,
  onSendBack,
}: {
  run: RunListItem;
  events: StoredEvent[];
  took: string;
  onReview: () => void;
  onSendBack: (message: string) => void;
}) {
  const o = outcomeOf(run);
  const d = run.digest;
  const cantStart = d.tests?.cantStart;
  const failure = o.tone === "bad" && !cantStart ? toErrors(events).at(-1) : undefined;
  const files = d.filesChanged.length;
  const title =
    run.status === "cancelled"
      ? "Stopped"
      : o.tone === "bad"
        ? cantStart
          ? "Checks couldn't run"
          : d.tests && !d.tests.passed
            ? `Checks failing${/\d/.test(d.tests.line) ? ` · ${d.tests.line}` : ""}`
            : "Didn't finish"
        : files
          ? `Done in ${took}${d.tests ? " · checks pass" : ""}`
          : `Answered in ${took}`;

  return (
    <section className={`summary-card ${o.tone}`} aria-label="Summary">
      <div className="sum-top">
        <span className="sum-mark" aria-hidden="true">
          {o.tone === "bad" ? "✗" : o.tone === "muted" ? "■" : "✓"}
        </span>
        <b>{title}</b>
      </div>
      <div className="facts">
        <span className="fact">
          {files ? `${files} file${files === 1 ? "" : "s"} changed` : "No files changed"}
        </span>
        {d.filesRead ? (
          <span className="fact">
            Read {d.filesRead} file{d.filesRead === 1 ? "" : "s"}
          </span>
        ) : null}
        {d.commands ? (
          <span className="fact">
            {d.commands} command{d.commands === 1 ? "" : "s"}
          </span>
        ) : null}
        {d.tests ? (
          <span className={`fact ${d.tests.passed ? "okc" : "badc"}`}>
            {/\d/.test(d.tests.line)
              ? `Tests: ${d.tests.line}`
              : d.tests.passed
                ? "Checks pass"
                : cantStart
                  ? "Couldn't run"
                  : "Checks fail"}
          </span>
        ) : null}
      </div>

      {cantStart ? (
        <p className="cant-start">
          <code>{d.tests?.command}</code> couldn't start: {cantStart}. That's your Mac's setup, not
          the code, so nothing was sent to the agent. helloagents tried the fixes it knows (the
          package manager in package.json, newer Node versions). Fix it, then click{" "}
          <b>Run checks</b>.
        </p>
      ) : null}
      {failure ? <pre className="excerpt">{failure.excerpt || failure.title}</pre> : null}
      {run.status !== "done" && run.error && !failure ? (
        <pre className="excerpt">{run.error}</pre>
      ) : null}

      <div className="sum-actions">
        {failure && run.worktree ? (
          <button
            className="btn btn-primary"
            onClick={() =>
              onSendBack(
                `This still fails:\n\n${failure.excerpt || failure.title}\n\nFix it and run the tests again.`,
              )
            }
          >
            <Icon name="send" size={13} /> Send this back to {agentName(run.agent ?? "claude-code")}
          </button>
        ) : null}
        {files && o.tone !== "bad" ? (
          <button className="btn" onClick={onReview}>
            Review changes
          </button>
        ) : null}
      </div>
    </section>
  );
}

function RunFacts({
  run,
  events,
  took,
  onTrace,
}: {
  run: RunListItem;
  events: StoredEvent[];
  took: string;
  onTrace: () => void;
}) {
  const tokens = tokenParts(run.usage);
  const start = events.find((e) => e.event.type === "agent.start")?.event;
  const model = start?.type === "agent.start" ? start.model : run.model;
  // Where the time went.
  let reading = 0;
  let thinking = 0;
  let commands = 0;
  for (const { event: e } of events) {
    if (e.type === "model.response") thinking += e.durationMs;
    if (e.type === "tool.result") {
      if (toolKind(e.name) === "read") reading += e.durationMs;
      else if (isCommandTool(e.name)) commands += e.durationMs;
    }
  }
  const spent = reading + thinking + commands;
  const total = spent || 1;

  return (
    <div className="run-facts-panel">
      <section>
        <h2 className="label">This run</h2>
        <dl className="run-facts">
          <dt>Agent</dt>
          <dd>{agentName(run.agent ?? "claude-code")}</dd>
          <dt>Model</dt>
          <dd title={model}>{model}</dd>
          {run.worktree ? (
            <>
              <dt>Branch</dt>
              <dd title={run.worktree.branch}>{run.worktree.branch}</dd>
            </>
          ) : null}
          <dt>Started</dt>
          <dd>
            {new Date(run.startedAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </dd>
          <dt>Took</dt>
          <dd>{took}</dd>
          <dt>New tokens</dt>
          <dd>{compact(tokens.fresh)}</dd>
          <dt>Cached</dt>
          <dd>{compact(tokens.cached)}</dd>
        </dl>
      </section>

      {spent > 0 ? (
        <section>
          <h2 className="label">Where the time went</h2>
          <div className="split-bar" aria-hidden="true">
            <i style={{ width: `${(reading / total) * 100}%` }} className="reading" />
            <i style={{ width: `${(thinking / total) * 100}%` }} className="thinking" />
            <i style={{ width: `${(commands / total) * 100}%` }} className="commands" />
          </div>
          <dl className="run-facts legend">
            <dt>
              <i className="reading" /> Reading files
            </dt>
            <dd>{ms(reading)}</dd>
            <dt>
              <i className="thinking" /> Thinking
            </dt>
            <dd>{ms(thinking)}</dd>
            <dt>
              <i className="commands" /> Running commands
            </dt>
            <dd>{ms(commands)}</dd>
          </dl>
        </section>
      ) : null}

      <button className="btn" onClick={onTrace}>
        <Icon name="trace" size={13} /> Open trace
      </button>
    </div>
  );
}

/** The follow-up box: one line until you click it. */
function Dock({
  runId,
  projectId,
  isClaude,
  enabled,
  active,
  inPlace,
  shipping,
  onShip,
}: {
  runId: string;
  projectId: string;
  isClaude: boolean;
  enabled: boolean;
  active: boolean;
  inPlace: boolean;
  shipping?: ShipKind;
  onShip: (kind: ShipKind) => Promise<void>;
}) {
  const api = window.helloagents;
  const [draft] = useState(() => loadDraft(`run.${runId}`));
  const [text, setText] = useState(draft.text);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string>();
  const images = useAttachments(setError, draft.images);
  const savedImages = JSON.stringify(images.saved());

  useEffect(() => {
    saveDraft(`run.${runId}`, { text, images: JSON.parse(savedImages) });
  }, [runId, text, savedImages]);
  const box = useRef<HTMLTextAreaElement>(null);
  const grip = useGrowBox(box, text, "follow-up", "top");
  const slash = useSlashMenu({
    projectId,
    text,
    enabled: enabled && isClaude,
    onInsert: (next) => {
      setText(next);
      box.current?.focus();
    },
  });

  // "push it", "open a PR": helloagents does that itself, since the agent can't.
  const intent = enabled && !active && !images.items.length ? shipIntent(text, inPlace) : null;

  async function send() {
    const message = text.trim();
    if (!message || !enabled || sending || images.saving || shipping) return;
    if (intent) {
      setText("");
      await onShip(intent);
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      await api.followUp(runId, message, images.paths());
      setText("");
      images.clear();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      className="dock"
      onSubmit={(e) => {
        e.preventDefault();
        void send();
      }}
    >
      <AttachmentStrip items={images.items} onRemove={images.remove} />
      <div
        className={`dock-box ${text || images.items.length ? "has-text" : ""} ${images.dragging ? "dragging" : ""}`}
        {...images.handlers}
      >
        {images.dragging ? <DropOverlay /> : null}
        {enabled ? grip : null}
        {slash.menu}
        <label htmlFor={`follow-${runId}`} className="sr">
          Follow-up
        </label>
        <textarea
          id={`follow-${runId}`}
          ref={box}
          value={text}
          disabled={!enabled}
          placeholder={
            active
              ? "Add to what it's doing: it reads this right away…"
              : "Ask a follow-up, or type / for commands, skills and connectors…"
          }
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (slash.onKeyDown(e)) return;
            // Enter sends; Shift+Enter adds a line.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {enabled ? <AttachButton onFiles={images.add} /> : null}
        <button
          className="icon-btn send"
          type="submit"
          disabled={!enabled || !text.trim() || sending || images.saving}
          aria-label="Send"
        >
          <Icon name="send" size={15} />
        </button>
      </div>
      <p className="dock-hint">
        {error ??
          "Follow-ups continue this conversation on the same branch · drop files to attach · ↵ to send, ⇧↵ for a new line"}
      </p>
    </form>
  );
}

/** Stop, resume, checks, dev server, open in an editor, ship, discard: what you can do with a run now. */
function RunActions({
  run,
  project,
  openers,
  confirmDiscard,
  setConfirmDiscard,
  onDiscard,
  onShip,
  shipping,
}: {
  run: RunListItem;
  project: ProjectRecord;
  openers: Opener[];
  confirmDiscard: boolean;
  setConfirmDiscard: (v: boolean) => void;
  onDiscard: () => void;
  onShip: (kind: ShipKind) => void;
  shipping?: ShipKind;
}) {
  const api = window.helloagents;
  const [busy, setBusy] = useState<string>();
  const worktree = run.worktree;
  const inPlace = run.settings.workspace === "checkout";
  const actions = project.actions;
  const o = outcomeOf(run);

  const act = async (label: string, job: () => Promise<unknown>, done?: (r: unknown) => void) => {
    setBusy(label);
    try {
      const r = await job();
      done?.(r);
    } catch (e) {
      showToast(errorText(e), { tone: "bad" });
    } finally {
      setBusy(undefined);
    }
  };
  const ship = onShip;

  if (run.active) {
    return (
      <div className="run-actions">
        <button className="btn" onClick={() => void api.cancelRun(run.id)}>
          <Icon name="stop" size={13} /> Stop
        </button>
      </div>
    );
  }
  if (!worktree) return <div className="run-actions" />;
  if (confirmDiscard) {
    return (
      <div className="run-actions">
        <span className="confirm">Delete this run's branch and files?</span>
        <button className="btn btn-danger" onClick={onDiscard}>
          Discard
        </button>
        <button className="btn btn-ghost" onClick={() => setConfirmDiscard(false)}>
          Keep
        </button>
      </div>
    );
  }
  const base = run.settings.baseBranch ?? "main";
  if (run.branchGone) {
    return (
      <div className="run-actions">
        <span className="gone">Branch discarded</span>
      </div>
    );
  }
  const canResume = run.status === "cancelled" || run.status === "error" || run.status === "budget";
  return (
    <div className="run-actions">
      {canResume ? (
        <button
          className="btn btn-primary"
          disabled={Boolean(busy)}
          onClick={() => void act("resume", () => api.resumeRun(run.id))}
        >
          <Icon name="resume" size={13} /> Resume
        </button>
      ) : null}
      {actions?.checks.length || actions?.dev ? (
        <div className="tool-group" role="group" aria-label="Project actions">
          {actions.checks.length ? (
            <button
              disabled={Boolean(busy)}
              title={actions.checks.join(" · ")}
              onClick={() => void act("checks", () => api.runChecks(run.id))}
            >
              {busy === "checks" ? <span className="spinner" /> : <Icon name="play" size={12} />}{" "}
              Run checks
            </button>
          ) : null}
          {actions.dev ? (
            run.devRunning ? (
              <button
                onClick={() => void api.stopDev(run.id)}
                title={`Running at ${actions.dev.url}`}
              >
                <i className="dot live" /> Stop server
              </button>
            ) : (
              <button
                disabled={Boolean(busy)}
                title={`${actions.dev.command} → ${actions.dev.url}`}
                onClick={() =>
                  void act(
                    "dev",
                    () => api.startDev(run.id),
                    (url) => showToast(`Dev server starting at ${String(url)}`),
                  )
                }
              >
                <Icon name="globe" size={13} /> Dev server
              </button>
            )
          ) : null}
        </div>
      ) : null}
      <Menu
        className="btn"
        align="right"
        width={210}
        trigger={
          <>
            <Icon name="open" size={13} /> Open{" "}
            <span className="caret">
              <Icon name="chevronDown" size={14} />
            </span>
          </>
        }
        items={openers.map((op) => ({
          id: op.id,
          label: op.name,
          onSelect: () => void act("open", () => api.openIn(op.id, worktree.path)),
        }))}
      />
      <Menu
        className={`btn ${o.tone === "ok" && !canResume ? "btn-primary" : ""}`}
        align="right"
        width={320}
        trigger={
          <>
            {shipping ? <span className="spinner" /> : <Icon name="ship" size={13} />} Ship{" "}
            <span className="caret">
              <Icon name="chevronDown" size={14} />
            </span>
          </>
        }
        items={[
          {
            id: "commit",
            label: "Commit",
            hint: `On ${worktree.branch}`,
            icon: <Icon name="check" size={13} />,
            onSelect: () => ship("commit"),
          },
          {
            id: "push",
            label: "Push branch",
            hint: `Commits, then pushes ${worktree.branch} to origin`,
            icon: <Icon name="arrowUp" size={13} />,
            onSelect: () => ship("push"),
          },
          ...(inPlace
            ? []
            : [
                {
                  id: "pr",
                  label: "Open a pull request",
                  hint: `Into ${base}, described from the summary and checks`,
                  icon: <Icon name="pr" size={13} />,
                  onSelect: () => ship("pr"),
                },
                {
                  id: "merge",
                  label: `Merge into ${base}`,
                  hint: "In your own checkout, which must be clean",
                  icon: <Icon name="branch" size={13} />,
                  onSelect: () => ship("merge"),
                },
              ]),
        ]}
      />
      <Menu
        className="icon-btn more"
        align="right"
        width={250}
        title="More"
        trigger={<Icon name="dots" size={16} />}
        items={[
          {
            id: "copy",
            label: "Copy branch name",
            hint: worktree.branch,
            icon: <Icon name="branch" size={13} />,
            onSelect: () =>
              void navigator.clipboard
                .writeText(worktree.branch)
                .then(() => showToast("Branch name copied")),
          },
          {
            id: "finder",
            label: "Show in Finder",
            icon: <Icon name="folder" size={13} />,
            onSelect: () => void api.revealInFinder(worktree.path),
          },
          ...(inPlace
            ? []
            : [
                {
                  id: "discard",
                  label: "Discard this run's branch",
                  hint: "Deletes its folder and branch. History stays.",
                  icon: <Icon name="trash" size={13} />,
                  onSelect: () => setConfirmDiscard(true),
                },
              ]),
        ]}
      />
    </div>
  );
}

/** The project isn't on GitHub yet: which repo should it go to? */
function ConnectCard({
  suggestion,
  kind,
  onConnect,
  onCancel,
}: {
  suggestion: string;
  kind: ShipKind;
  onConnect: (repo: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [repo, setRepo] = useState(suggestion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  return (
    <section className="connect-card" aria-label="Put this project on GitHub">
      <div className="approval-head">
        <Icon name="git" size={13} />
        <b>Put this project on GitHub</b>
      </div>
      <p>
        It isn't connected to a GitHub repo yet. helloagents uses the repo if it exists, or creates
        it as private, then {kind === "pr" ? "pushes and opens the pull request" : "pushes"}.
      </p>
      <form
        className="connect-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (!repo.trim() || busy) return;
          setBusy(true);
          setError(undefined);
          void onConnect(repo.trim())
            .catch((err: unknown) => setError(errorText(err)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="repo-input">
          github.com/
          <input
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            aria-label="GitHub repo (owner/name)"
            spellCheck={false}
          />
        </label>
        <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !repo.trim()}>
          {busy ? <span className="spinner" /> : null}
          {kind === "pr" ? "Connect and open PR" : "Connect and push"}
        </button>
        <button className="btn btn-sm" type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </form>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
