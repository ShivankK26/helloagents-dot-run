import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { SlashCommand } from "../../../shared/api";

/** "/model" and "/effort" open helloagents' own pickers instead of going to the agent. */
export type LocalCommand = "model" | "effort";

interface Entry {
  name: string;
  description: string;
  tag: string;
  local?: LocalCommand;
}

const LOCAL: Entry[] = [
  { name: "model", description: "Choose the model", tag: "picker", local: "model" },
  { name: "effort", description: "Choose how hard it thinks", tag: "picker", local: "effort" },
];

/**
 * The "/" menu: Claude Code's commands and skills for this project, filtered as
 * you type. Loaded the first time "/" is typed; the main process caches them.
 */
export function useSlashMenu({
  projectId,
  text,
  enabled,
  onInsert,
  onLocal,
}: {
  projectId: string;
  text: string;
  enabled: boolean;
  onInsert: (text: string) => void;
  onLocal: (command: LocalCommand) => void;
}) {
  const api = window.helloagents;
  // Keyed by project, so switching projects loads that project's list.
  const [loaded, setLoaded] = useState<{
    projectId: string;
    list?: SlashCommand[];
    failed?: boolean;
  }>();
  const commands = loaded?.projectId === projectId ? loaded.list : undefined;
  const failed = loaded?.projectId === projectId && Boolean(loaded.failed);
  const [dismissed, setDismissed] = useState<string>();
  // Only while typing the command itself: "/sec", not "/security-review the api".
  const query = enabled ? /^\/([\w:-]*)$/.exec(text)?.[1] : undefined;
  const open = query !== undefined && dismissed !== text;

  useEffect(() => {
    if (!open || commands || failed) return;
    let live = true;
    api.listSlashCommands(projectId).then(
      (list) => live && setLoaded({ projectId, list }),
      () => live && setLoaded({ projectId, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [open, commands, failed, projectId, api]);

  const entries = useMemo(() => {
    if (query === undefined) return [];
    const q = query.toLowerCase();
    const all: Entry[] = [
      ...LOCAL,
      ...(commands ?? []).map((c) => ({ name: c.name, description: c.description, tag: c.kind })),
    ];
    if (!q) return all;
    // Names that start with the query first, then any that contain it (or, from three
    // letters on, whose description does).
    const starts = all.filter((e) => e.name.toLowerCase().startsWith(q));
    const rest = all.filter(
      (e) =>
        !starts.includes(e) &&
        (e.name.toLowerCase().includes(q) ||
          (q.length >= 3 && e.description.toLowerCase().includes(q))),
    );
    return [...starts, ...rest];
  }, [query, commands]);

  // The highlighted row, back to the top whenever the query changes.
  const [highlight, setHighlight] = useState({ query, index: 0 });
  const active = highlight.query === query ? highlight.index : 0;
  const setActive = (index: number) => setHighlight({ query, index });

  const pick = (entry: Entry) => {
    if (entry.local) {
      onInsert("");
      onLocal(entry.local);
    } else onInsert(`/${entry.name} `);
  };

  return {
    open,
    /** Handles ↑ ↓ Enter Tab Escape while the menu is open. Returns true if it used the key. */
    onKeyDown(e: KeyboardEvent): boolean {
      if (!open) return false;
      if (e.key === "Escape") {
        setDismissed(text);
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const n = entries.length || 1;
        setActive((active + (e.key === "ArrowDown" ? 1 : n - 1)) % n);
      } else if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
        const entry = entries[active];
        if (!entry) return false;
        pick(entry);
      } else return false;
      e.preventDefault();
      return true;
    },
    menu: open ? (
      <SlashList
        entries={entries}
        active={active}
        loading={!commands && !failed}
        failed={failed}
        onHover={setActive}
        onPick={pick}
      />
    ) : null,
  };
}

function SlashList({
  entries,
  active,
  loading,
  failed,
  onHover,
  onPick,
}: {
  entries: Entry[];
  active: number;
  loading: boolean;
  failed: boolean;
  onHover: (i: number) => void;
  onPick: (e: Entry) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector(".slash-o.on")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  return (
    <div className="slash" role="listbox" aria-label="Commands and skills" ref={list}>
      {entries.map((e, i) => (
        <button
          key={e.name}
          type="button"
          role="option"
          aria-selected={i === active}
          className={`slash-o ${i === active ? "on" : ""}`}
          onMouseEnter={() => onHover(i)}
          // Keep focus in the text box.
          onMouseDown={(ev) => ev.preventDefault()}
          onClick={() => onPick(e)}
        >
          <span className="slash-name">/{e.name}</span>
          <span className="slash-desc">{e.description}</span>
          <span className="slash-tag">{e.tag}</span>
        </button>
      ))}
      {loading ? <div className="slash-note">Loading your commands and skills…</div> : null}
      {failed ? <div className="slash-note">Couldn't read Claude Code's commands.</div> : null}
      {!loading && !entries.length ? (
        <div className="slash-note">No matching command or skill.</div>
      ) : null}
    </div>
  );
}
