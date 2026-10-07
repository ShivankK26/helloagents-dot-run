import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
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

type Spot = { x: number; y: number };

/** Where the palette was dragged to; kept while the app is open. */
let moved: Spot | null = null;

/** Keeps the whole box inside the window. */
const fit = (s: Spot, el: HTMLElement): Spot => ({
  x: Math.max(8, Math.min(s.x, window.innerWidth - el.offsetWidth - 8)),
  y: Math.max(8, Math.min(s.y, window.innerHeight - el.offsetHeight - 8)),
});

/** ⌘K: everything in the app from the keyboard. */
export function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState<Spot | null>(moved);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus({ preventScroll: true }), []);

  // Opens centered on screen. The top stays put as the list shrinks while typing.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setSpot((s) =>
      fit(
        s ?? {
          x: (window.innerWidth - el.offsetWidth) / 2,
          y: (window.innerHeight - el.offsetHeight) / 2,
        },
        el,
      ),
    );
  }, []);

  const drag = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || !spot || !box.current) return;
    e.preventDefault();
    const el = box.current;
    const start = { x: e.clientX - spot.x, y: e.clientY - spot.y };
    const move = (ev: globalThis.PointerEvent) => {
      const next = fit({ x: ev.clientX - start.x, y: ev.clientY - start.y }, el);
      moved = next;
      setSpot(next);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      input.current?.focus({ preventScroll: true });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Double-click the grip to put it back in the middle.
  const recenter = () => {
    const el = box.current;
    if (!el) return;
    moved = null;
    setSpot({
      x: (window.innerWidth - el.offsetWidth) / 2,
      y: (window.innerHeight - el.offsetHeight) / 2,
    });
    input.current?.focus({ preventScroll: true });
  };

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
      <div
        ref={box}
        className="palette"
        role="dialog"
        aria-label="Command menu"
        style={spot ? { left: spot.x, top: spot.y } : { visibility: "hidden" }}
      >
        <div
          className="pal-grip"
          title="Drag to move · double-click to center"
          onPointerDown={drag}
          onDoubleClick={recenter}
        />
        <div className="pal-in" onPointerDown={(e) => e.target === e.currentTarget && drag(e)}>
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
