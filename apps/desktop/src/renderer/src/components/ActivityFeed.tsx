import { useEffect, useState, type ReactNode } from "react";
import {
  describeToolCall,
  digestRun,
  isCommandTool,
  testResultLine,
  toolKind,
  toolPath,
} from "@helloagents/engine/views";
import type { ApprovalAnswer, ApprovalRequest, ShipKind, StoredEvent } from "../../../shared/api";
import { ms } from "../format";
import { SHIP_LABEL, shortPath } from "../ship";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";

type ToolResult = Extract<StoredEvent["event"], { type: "tool.result" }>;

type Item =
  | { kind: "you"; key: number; text: string }
  | { kind: "say"; key: number; text: string }
  | { kind: "reads"; key: number; files: string[]; ms: number }
  | { kind: "tool"; key: number; event: ToolResult }
  | { kind: "pending"; key: number; label: string }
  | { kind: "note"; key: number; text: string }
  | { kind: "image"; key: number; path: string }
  | {
      kind: "end";
      key: number;
      files: number;
      checks?: { ok: boolean; cantStart: boolean };
      ms: number;
    };

const lines = (v: unknown) => (typeof v === "string" && v ? v.split("\n").length : 0);

/** Rough +/− for an edit, from the tool's own input. */
export function editStats(input: unknown): { add: number; del: number } {
  const i = (input ?? {}) as Record<string, unknown>;
  if (Array.isArray(i.edits)) {
    return (i.edits as unknown[]).reduce<{ add: number; del: number }>(
      (acc, e) => {
        const s = editStats(e);
        return { add: acc.add + s.add, del: acc.del + s.del };
      },
      { add: 0, del: 0 },
    );
  }
  const added = i.new_string ?? i.new_text ?? i.new_str ?? i.content;
  const removed = i.old_string ?? i.old_text ?? i.old_str;
  return { add: lines(added), del: lines(removed) };
}

const IMAGE = /\.(?:png|jpe?g|gif|webp)$/i;
const TEST = /\b(test|tests|jest|vitest|pytest|mocha|playwright|rspec)\b|go test|cargo test/i;
const tail = (text: string, n = 30) => text.trimEnd().split("\n").slice(-n).join("\n");

function build(events: StoredEvent[], active: boolean, hideAnswer: string, root?: string): Item[] {
  const items: Item[] = [];
  const results = new Set<string>();
  for (const { event } of events) if (event.type === "tool.result") results.add(event.id);

  // Each turn (your message, the agent's work, the checks) closes with a "Done" line.
  let turn: {
    startAt: number;
    lastAt: number;
    files: Set<string>;
    checks?: { ok: boolean; cantStart: boolean };
    done: boolean;
    ended: boolean;
  } | null = null;
  const closeTurn = (key: number) => {
    if (turn?.done)
      items.push({
        kind: "end",
        key,
        files: turn.files.size,
        ...(turn.checks && { checks: turn.checks }),
        ms: turn.lastAt - turn.startAt,
      });
    turn = null;
  };

  for (const { seq, event: e } of events) {
    // helloagents' own steps (shipping, freeing the folder) come after the turn's Done line,
    // unless the agent itself asked for them while working.
    const own =
      e.type === "tool.result" &&
      (e.name === "ship" || e.name === "folder") &&
      (!turn || turn.ended);
    if (turn && e.type !== "agent.start" && !own) turn.lastAt = e.at;
    if (e.type === "agent.start" || own) closeTurn(seq - 0.5);
    if (e.type === "agent.start") {
      turn = { startAt: e.at, lastAt: e.at, files: new Set(), done: false, ended: false };
      items.push({ kind: "you", key: seq, text: e.task });
    } else if (e.type === "agent.end" && turn) {
      turn.done = e.status === "done";
      turn.ended = true;
    }
    if (turn && e.type === "tool.result") {
      if (toolKind(e.name) === "edit" && e.ok) turn.files.add(toolPath(e.input) ?? e.name);
      if (e.name === "checks")
        turn.checks = {
          ok: e.ok,
          cantStart: Boolean((e.input as { cantStart?: string }).cantStart),
        };
    }
    if (e.type === "agent.start") continue;
    if (e.type === "user.message") {
      items.push({ kind: "you", key: seq, text: e.text });
      continue;
    }
    if (e.type === "model.response" && e.text.trim()) {
      items.push({ kind: "say", key: seq, text: e.text });
    } else if (e.type === "tool.result") {
      const readPath = toolKind(e.name) === "read" ? toolPath(e.input) : undefined;
      if (readPath && IMAGE.test(readPath) && e.ok) {
        // Screenshots the agent looked at are shown, not just listed.
        const full = readPath.startsWith("/") || !root ? readPath : `${root}/${readPath}`;
        items.push({ kind: "image", key: seq, path: full });
      } else if (toolKind(e.name) === "read") {
        const last = items.at(-1);
        const file = shortPath(toolPath(e.input) ?? describeToolCall(e.name, e.input), root);
        if (last?.kind === "reads") {
          if (!last.files.includes(file)) last.files.push(file);
          last.ms += e.durationMs;
        } else items.push({ kind: "reads", key: seq, files: [file], ms: e.durationMs });
      } else if (e.name !== "finish") items.push({ kind: "tool", key: seq, event: e });
    } else if (e.type === "agent.end" && e.status !== "done") {
      items.push({
        kind: "note",
        key: seq,
        text: e.status === "cancelled" ? "Stopped." : `Stopped early: ${e.summary}`,
      });
    }
  }

  // The final answer is shown in the summary card, so don't repeat it here.
  if (!active && hideAnswer) {
    for (let i = items.length - 1; i >= 0; i--) {
      const it = items[i];
      if (it?.kind === "say") {
        if (it.text.trim() === hideAnswer) items.splice(i, 1);
        break;
      }
    }
  }

  if (!active) closeTurn(Number.MAX_SAFE_INTEGER);

  if (active) {
    // A tool the model asked for that hasn't returned yet is what's running now.
    const lastAsk = [...events].reverse().find((s) => s.event.type === "model.response");
    const waiting =
      lastAsk?.event.type === "model.response"
        ? lastAsk.event.toolCalls.find((c) => !results.has(c.id))
        : undefined;
    items.push({
      kind: "pending",
      key: -1,
      label: waiting ? describeToolCall(waiting.name, waiting.input) : "Thinking…",
    });
  }
  return items;
}

function Step({
  e,
  root,
  onOpenRun,
}: {
  e: ToolResult;
  root?: string;
  onOpenRun?: (runId: string) => void;
}) {
  if (e.name === "ship") return <Shipped e={e} />;
  if (e.name === "run") {
    const { runId, task, project } = e.input as { runId?: string; task?: string; project?: string };
    return (
      <div className="step ok">
        <span className="k">
          <Icon name="plus" size={12} />
        </span>
        <span className="step-cmd">
          New run in {project}: <code>{task?.split("\n")[0]}</code>
        </span>
        <span className="r">
          {runId && onOpenRun ? (
            <button className="link-btn" onClick={() => onOpenRun(runId)}>
              Open
            </button>
          ) : null}
        </span>
      </div>
    );
  }
  if (e.name === "folder")
    return (
      <div className="step ok folder-step">
        <span className="k">
          <Icon name="folder" size={12} />
        </span>
        <span>{e.output}</span>
        <span className="r">by helloagents</span>
      </div>
    );
  const kind = toolKind(e.name);
  if (kind === "edit") {
    const { add, del } = editStats(e.input);
    const created = /^(Write|write_file)$/.test(e.name);
    return (
      <div className={`step ${e.ok ? "ok" : "bad"}`}>
        <span className="k">
          <Icon name="edit" size={12} />
        </span>
        <span>
          {created ? "Wrote " : "Edited "}
          <code>{shortPath(toolPath(e.input) ?? e.name, root)}</code>
          {e.ok ? null : <span className="bad-text"> · failed</span>}
        </span>
        <span className="r">
          {add ? <span className="add">+{add}</span> : null}{" "}
          {del ? <span className="del">−{del}</span> : null}
        </span>
      </div>
    );
  }
  if (isCommandTool(e.name)) {
    const command = describeToolCall(e.name, e.input);
    const isTest = e.name === "checks" || (e.name !== "setup" && TEST.test(command));
    return (
      <details className={`step-details ${e.ok ? "" : "bad"}`} open={!e.ok && isTest}>
        <summary className={`step ${e.ok ? "ok" : "bad"}`}>
          <span className="k">
            <Icon name="term" size={12} />
          </span>
          <span className="step-cmd">
            {e.name === "checks" || e.name === "setup" ? (
              <>
                {e.name === "checks" ? "Checks " : "Setup "}
                <code>{((e.input as { commands?: string[] }).commands ?? []).join(" · ")}</code>
              </>
            ) : (
              <>
                Ran <code>{command}</code>
              </>
            )}
          </span>
          <span className={`r ${isTest ? (e.ok ? "okc" : "badc") : ""}`}>
            {isTest
              ? testResultLine(e.output, e.ok)
              : e.ok
                ? e.durationMs >= 50
                  ? ms(e.durationMs)
                  : ""
                : "failed"}
          </span>
        </summary>
        <pre className="tail">{tail(e.output) || "(no output)"}</pre>
      </details>
    );
  }
  return (
    <details className="step-details">
      <summary className={`step ${e.ok ? "ok" : "bad"}`}>
        <span className="k">
          <Icon name="check" size={12} />
        </span>
        <span>
          <code>{describeToolCall(e.name, e.input)}</code>
        </span>
        <span className="r">{e.durationMs >= 50 ? ms(e.durationMs) : ""}</span>
      </summary>
      <pre className="tail">{tail(e.output) || "(no output)"}</pre>
    </details>
  );
}

/** What the agent did, as a readable story: messages, grouped reads, edits and commands. */
export function ActivityFeed({
  events,
  active,
  hideAnswer = "",
  root,
  shipKinds = [],
  shipping,
  onShip,
  approval,
  onAnswer,
  mode,
  children,
  onOpenRun,
}: {
  events: StoredEvent[];
  active: boolean;
  /** The final answer, already shown in the summary card. */
  hideAnswer?: string;
  /** The run's folder, so paths can be shown relative to it. */
  root?: string;
  /** Ship buttons offered on the last "Done" line. */
  shipKinds?: ShipKind[];
  shipping?: ShipKind;
  onShip?: (kind: ShipKind) => void;
  /** What the agent is waiting for the user to allow. */
  approval?: ApprovalRequest;
  onAnswer?: (answer: ApprovalAnswer) => void;
  /** The run's mode ("auto", "edits"…). */
  mode?: string;
  /** Shown after everything else, e.g. "connect to GitHub". */
  children?: ReactNode;
  /** Opens a run this one started. */
  onOpenRun?: (runId: string) => void;
}) {
  const background = active ? digestRun(events).background : null;
  const items = build(events, active && !approval && !background, hideAnswer, root);
  // Ship buttons go on the last "Done", minus what was already shipped after it.
  const endAt = items.findLastIndex((it) => it.kind === "end");
  const lastEnd =
    endAt >= 0 && endAt >= items.findLastIndex((it) => it.kind === "you")
      ? items[endAt]?.key
      : undefined;
  const shippedAfter = new Set(
    items
      .slice(endAt + 1)
      .flatMap((it) =>
        it.kind === "tool" && it.event.name === "ship" && it.event.ok
          ? [(it.event.input as { kind?: ShipKind }).kind]
          : [],
      ),
  );
  const offer =
    shippedAfter.has("pr") || shippedAfter.has("merge")
      ? []
      : shipKinds.filter((k) => !shippedAfter.has(k));
  // Consecutive steps share one indented track; messages sit between them.
  const blocks: Array<{ key: number; steps?: Item[]; item?: Item }> = [];
  for (const it of items) {
    const isStep =
      it.kind === "reads" || it.kind === "tool" || it.kind === "pending" || it.kind === "image";
    const last = blocks.at(-1);
    if (isStep && last?.steps) last.steps.push(it);
    else if (isStep) blocks.push({ key: it.key, steps: [it] });
    else blocks.push({ key: it.key, item: it });
  }

  return (
    <div className="feed-list">
      {blocks.map((b) =>
        b.steps ? (
          <div key={b.key} className="steps">
            {b.steps.map((it) => {
              if (it.kind === "reads") {
                return (
                  <details key={it.key} className="step-details">
                    <summary className="step ok">
                      <span className="k">
                        <Icon name="eye" size={12} />
                      </span>
                      <span>
                        {it.files.length === 1 ? (
                          <>
                            Read <code>{it.files[0]}</code>
                          </>
                        ) : (
                          <>
                            Explored {it.files.length} files <Icon name="chevron" size={11} />
                          </>
                        )}
                      </span>
                      <span className="r">{it.ms >= 50 ? ms(it.ms) : ""}</span>
                    </summary>
                    {it.files.length > 1 ? (
                      <ul className="sub">
                        {it.files.map((f) => (
                          <li key={f}>{f}</li>
                        ))}
                      </ul>
                    ) : null}
                  </details>
                );
              }
              if (it.kind === "image")
                return <AgentImage key={it.key} path={it.path} root={root} />;
              if (it.kind === "pending") {
                return (
                  <div key={it.key} className="step now">
                    <span className="k">
                      <span className="spinner" />
                    </span>
                    <span>{it.label === "Thinking…" ? it.label : <code>{it.label}</code>}</span>
                    <span className="r">now</span>
                  </div>
                );
              }
              return it.kind === "tool" ? (
                <Step key={it.key} e={it.event} root={root} onOpenRun={onOpenRun} />
              ) : null;
            })}
          </div>
        ) : b.item?.kind === "you" ? (
          <YouSaid key={b.key} text={b.item.text} />
        ) : b.item?.kind === "say" ? (
          <div key={b.key} className="say">
            <Markdown text={b.item.text} />
          </div>
        ) : b.item?.kind === "end" ? (
          <TurnEnd
            key={b.key}
            item={b.item}
            ship={b.key === lastEnd && b.item.files ? offer : []}
            shipping={shipping}
            onShip={onShip}
          />
        ) : b.item?.kind === "note" ? (
          <p key={b.key} className="note">
            {b.item.text}
          </p>
        ) : null,
      )}
      {approval ? (
        approval.tool === "ExitPlanMode" ? (
          <PlanCard key={approval.id} plan={approval.description} onAnswer={onAnswer} />
        ) : (
          <ApprovalCard key={approval.id} request={approval} mode={mode} onAnswer={onAnswer} />
        )
      ) : null}
      {background && !approval ? (
        <BackgroundCard tasks={background.tasks} since={background.since} />
      ) : null}
      {children}
    </div>
  );
}

/** Like Claude Code's permission prompt: the agent waits until you answer. */
function ApprovalCard({
  request,
  mode,
  onAnswer,
}: {
  request: ApprovalRequest;
  mode?: string;
  onAnswer?: (answer: ApprovalAnswer) => void;
}) {
  const [sent, setSent] = useState<ApprovalAnswer>();
  const answer = (a: ApprovalAnswer) => {
    setSent(a);
    onAnswer?.(a);
  };
  // "Bash(xcodebuild:*)" reads as "xcodebuild commands".
  const rule = request.rule
    ? /^Bash\((.+?)(?::\*)?\)$/.exec(request.rule)?.[1]
      ? `${/^Bash\((.+?)(?::\*)?\)$/.exec(request.rule)?.[1]} commands`
      : request.rule
    : undefined;
  return (
    <section className="approval" aria-label="Needs your OK">
      <div className="approval-head">
        <Icon name="lock" size={13} />
        <b>
          {request.tool === "Bash"
            ? "Claude wants to run a command"
            : `Claude wants to use ${request.tool}`}
        </b>
      </div>
      <pre className="approval-what">{request.description}</pre>
      {request.reason && !/requires approval/i.test(request.reason) ? (
        <p className="approval-why">{request.reason}</p>
      ) : null}
      <div className="approval-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={Boolean(sent)}
          onClick={() => answer("allow")}
        >
          {sent === "allow" ? <span className="spinner" /> : null}
          Allow
        </button>
        {rule ? (
          <button className="btn btn-sm" disabled={Boolean(sent)} onClick={() => answer("always")}>
            {sent === "always" ? <span className="spinner" /> : null}
            Always allow <code>{rule}</code>
          </button>
        ) : null}
        <button className="btn btn-sm" disabled={Boolean(sent)} onClick={() => answer("deny")}>
          Deny
        </button>
        {mode !== "auto" ? (
          <button
            className="btn btn-sm"
            disabled={Boolean(sent)}
            title="Allow this, and let the agent decide the safe things itself from now on"
            onClick={() => answer("auto")}
          >
            {sent === "auto" ? <span className="spinner" /> : null}
            Switch to Auto
          </button>
        ) : null}
        <span className="approval-note">The run is paused until you answer.</span>
      </div>
    </section>
  );
}

/** Must match ATTACHMENTS_HEADER in the engine, which adds this note to the prompt
 * (runs before 0.2.30 said "images"). */
const ATTACHED = /\n\n\[Attached (?:files|images)\]\n/;
/** Must match NOTE_HEADER in the engine: a note for the agent, not something you wrote. */
const NOTE = "\n\n[Note from helloagents]\n";

/** What you asked, with attached images shown as chips instead of the note the agent sees. */
function YouSaid({ text }: { text: string }) {
  // Notes helloagents added for the agent (attached images, approvals) aren't shown as text.
  const found = ATTACHED.exec(text);
  const at = found ? found.index : -1;
  const cuts = [text.indexOf(NOTE), at].filter((i) => i >= 0);
  const asked = cuts.length ? text.slice(0, Math.min(...cuts)) : text;
  const images = !found
    ? []
    : text
        .slice(at + found[0].length)
        .split("\n")
        .filter((l) => l.startsWith("- "))
        .map((l) => l.slice(2));
  return (
    <div className="you">
      <small>You</small>
      {asked}
      {images.length ? (
        <div className="you-images">
          {images.map((p) => (
            <span key={p} className="you-image" title={p}>
              <Icon name={/\.(png|jpe?g|gif|webp)$/i.test(p) ? "image" : "file"} size={12} />
              {/* Saved as "<id>-<name>"; show the name. */}
              {(p.split("/").pop() ?? p).replace(/^[0-9a-f]{8}-/, "")}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** The line that closes a turn: "Done", what changed, the checks, how long; and Ship buttons on the last. */
function TurnEnd({
  item,
  ship,
  shipping,
  onShip,
}: {
  item: Extract<Item, { kind: "end" }>;
  ship: ShipKind[];
  shipping?: ShipKind;
  onShip?: (kind: ShipKind) => void;
}) {
  const bad = item.checks && !item.checks.ok;
  const facts = [
    item.files ? `${item.files} file${item.files === 1 ? "" : "s"} changed` : "no changes",
    item.checks
      ? item.checks.ok
        ? "checks pass"
        : item.checks.cantStart
          ? "checks couldn't run"
          : "checks failing"
      : null,
    item.ms >= 1000 ? ms(item.ms) : null,
  ].filter(Boolean);
  return (
    <div className={`turn-end ${bad ? "bad" : "ok"}`}>
      <span className="turn-mark" aria-hidden="true">
        {bad ? "✗" : "✓"}
      </span>
      <b>Done</b>
      <span className="turn-facts">{facts.join(" · ")}</span>
      {ship.length ? (
        <span className="turn-ship">
          {ship.map((k, i) => (
            <button
              key={k}
              type="button"
              className={`btn btn-sm ${i === ship.length - 1 ? "btn-primary" : ""}`}
              disabled={Boolean(shipping)}
              onClick={() => onShip?.(k)}
            >
              {shipping === k ? <span className="spinner" /> : null}
              {k === "pr"
                ? "Open PR"
                : k === "push"
                  ? "Push"
                  : k === "merge"
                    ? "Merge into main"
                    : SHIP_LABEL[k]}
            </button>
          ))}
        </span>
      ) : null}
    </div>
  );
}

/** A commit, push, PR or merge helloagents did for this run. */
function Shipped({ e }: { e: ToolResult }) {
  const { kind, url } = e.input as { kind?: ShipKind; url?: string };
  return (
    <div className={`step ${e.ok ? "ok" : "bad"}`}>
      <span className="k">
        <Icon name={kind === "pr" ? "pr" : kind === "merge" ? "merge" : "ship"} size={12} />
      </span>
      <span>
        {e.ok ? e.output : `${kind ? SHIP_LABEL[kind] : "Ship"} failed: ${e.output}`}
        {url ? (
          <>
            {" · "}
            <button className="link-btn" onClick={() => void window.helloagents.openExternal(url)}>
              View on GitHub
            </button>
          </>
        ) : null}
      </span>
      <span className="r">{e.ok ? "by helloagents" : "failed"}</span>
    </div>
  );
}

/** An image the agent looked at, like a simulator screenshot. Click to see it full size. */
function AgentImage({ path, root }: { path: string; root?: string }) {
  const [src, setSrc] = useState<string | null>();
  const [big, setBig] = useState(false);
  useEffect(() => {
    let live = true;
    void window.helloagents.readImage(path).then((d) => live && setSrc(d));
    return () => {
      live = false;
    };
  }, [path]);
  return (
    <figure className="agent-image">
      <figcaption className="step ok">
        <span className="k">
          <Icon name="image" size={12} />
        </span>
        <span>
          Looked at <code>{shortPath(path, root)}</code>
        </span>
        <span className="r" />
      </figcaption>
      {src ? (
        <button
          type="button"
          className={`agent-shot ${big ? "big" : ""}`}
          onClick={() => setBig(!big)}
        >
          <img src={src} alt={shortPath(path, root)} />
        </button>
      ) : null}
    </figure>
  );
}

/** Like Claude Code's background shell: still running, and the agent carries on when it ends. */
function BackgroundCard({ tasks, since }: { tasks: string[]; since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <section className="background-card" aria-label="Running in the background">
      <div className="approval-head">
        <span className="spinner" />
        <b>Running in the background</b>
        <span className="bg-time">{ms(now - since)}</span>
      </div>
      {tasks.map((t) => (
        <pre key={t} className="approval-what">
          {t}
        </pre>
      ))}
      <p className="approval-why">
        Claude continues on its own when {tasks.length === 1 ? "it finishes" : "they finish"}. You
        can leave this open or close the window; Stop ends it.
      </p>
    </section>
  );
}

/** Plan mode: the agent's plan, waiting for a go-ahead before it changes anything. */
function PlanCard({
  plan,
  onAnswer,
}: {
  plan: string;
  onAnswer?: (answer: ApprovalAnswer) => void;
}) {
  const [sent, setSent] = useState<ApprovalAnswer>();
  const answer = (a: ApprovalAnswer) => {
    setSent(a);
    onAnswer?.(a);
  };
  return (
    <section className="approval plan" aria-label="Claude's plan">
      <div className="approval-head">
        <Icon name="layers" size={13} />
        <b>Claude's plan</b>
      </div>
      <div className="plan-body">
        <Markdown text={plan} />
      </div>
      <div className="approval-actions">
        <button
          className="btn btn-primary btn-sm"
          disabled={Boolean(sent)}
          onClick={() => answer("auto")}
        >
          {sent === "auto" ? <span className="spinner" /> : null}
          Approve and build
        </button>
        <button className="btn btn-sm" disabled={Boolean(sent)} onClick={() => answer("deny")}>
          Keep planning
        </button>
        <span className="approval-note">Reply below to change the plan.</span>
      </div>
    </section>
  );
}
