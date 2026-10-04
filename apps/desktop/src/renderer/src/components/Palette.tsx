import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Icon } from "./Icons";

export interface Command {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
  shortcut?: string;
  run: () => void;
}

/** ⌘K: everything in the app from the keyboard. */
export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return commands
      .filter((c) =>
        words.every((w) => `${c.label} ${c.hint ?? ""} ${c.group}`.toLowerCase().includes(w)),
      )
      .slice(0, 40);
  }, [commands, query]);

  const choose = (c?: Command) => {
    if (!c) return;
    onClose();
    c.run();
  };

  return (
    <div
      className="scrim palette-scrim"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="palette" role="dialog" aria-label="Command menu">
        <div className="pal-in">
          <Icon name="search" size={17} />
          <input
            ref={input}
            value={query}
            placeholder="Type a command, a run or a project…"
            aria-label="Search commands"
            onChange={(e) => {
              setQuery(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(i + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                choose(shown[index]);
              }
            }}
          />
          <span className="kbd">esc</span>
        </div>
        <div className="pal-list" role="listbox">
          {shown.length === 0 ? <p className="empty">Nothing matches “{query}”.</p> : null}
          {shown.map((c, i) => {
            const header = i === 0 || shown[i - 1]?.group !== c.group ? c.group : null;
            return (
              <div key={c.id}>
                {header ? <div className="pal-g">{header}</div> : null}
                <button
                  role="option"
                  aria-selected={i === index}
                  className="pal-o"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => choose(c)}
                >
                  <span className="pal-icon">{c.icon}</span>
                  <span className="pal-text">
                    {c.label}
                    {c.hint ? <small>{c.hint}</small> : null}
                  </span>
                  {c.shortcut ? <span className="kbd">{c.shortcut}</span> : null}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
