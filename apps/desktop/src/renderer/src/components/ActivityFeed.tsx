import {
  describeToolCall,
  isCommandTool,
  testResultLine,
  toolKind,
  toolPath,
} from "@helloagents/engine/views";
import type { StoredEvent } from "../../../shared/api";
import { ms } from "../format";
import { Icon } from "./Icons";
import { Markdown } from "./Markdown";

type ToolResult = Extract<StoredEvent["event"], { type: "tool.result" }>;

type Item =
  | { kind: "you"; key: number; text: string }
  | { kind: "say"; key: number; text: string }
  | { kind: "reads"; key: number; files: string[]; ms: number }
  | { kind: "tool"; key: number; event: ToolResult }
  | { kind: "pending"; key: number; label: string }
  | { kind: "note"; key: number; text: string };

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

const TEST = /\b(test|tests|jest|vitest|pytest|mocha|playwright|rspec)\b|go test|cargo test/i;
const tail = (text: string, n = 30) => text.trimEnd().split("\n").slice(-n).join("\n");

function build(events: StoredEvent[], active: boolean, hideAnswer: string): Item[] {
  const items: Item[] = [];
  const results = new Set<string>();
  for (const { event } of events) if (event.type === "tool.result") results.add(event.id);

  for (const { seq, event: e } of events) {
    if (e.type === "agent.start") items.push({ kind: "you", key: seq, text: e.task });
    else if (e.type === "model.response" && e.text.trim()) {
      items.push({ kind: "say", key: seq, text: e.text });
    } else if (e.type === "tool.result") {
      if (toolKind(e.name) === "read") {
        const last = items.at(-1);
        const file = toolPath(e.input) ?? describeToolCall(e.name, e.input);
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

function Step({ e }: { e: ToolResult }) {
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
          <code>{toolPath(e.input) ?? e.name}</code>
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
            {isTest ? testResultLine(e.output, e.ok) : e.ok ? ms(e.durationMs) : "failed"}
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
        <span className="r">{ms(e.durationMs)}</span>
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
}: {
  events: StoredEvent[];
  active: boolean;
  /** The final answer, already shown in the summary card. */
  hideAnswer?: string;
}) {
  const items = build(events, active, hideAnswer);
  // Consecutive steps share one indented track; messages sit between them.
  const blocks: Array<{ key: number; steps?: Item[]; item?: Item }> = [];
  for (const it of items) {
    const isStep = it.kind === "reads" || it.kind === "tool" || it.kind === "pending";
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
                      <span className="r">{ms(it.ms)}</span>
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
              return it.kind === "tool" ? <Step key={it.key} e={it.event} /> : null;
            })}
          </div>
        ) : b.item?.kind === "you" ? (
          <div key={b.key} className="you">
            <small>You</small>
            {b.item.text}
          </div>
        ) : b.item?.kind === "say" ? (
          <div key={b.key} className="say">
            <Markdown text={b.item.text} />
          </div>
        ) : b.item?.kind === "note" ? (
          <p key={b.key} className="note">
            {b.item.text}
          </p>
        ) : null,
      )}
    </div>
  );
}
