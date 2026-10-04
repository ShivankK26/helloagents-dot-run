import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export type MenuItem =
  | { header: string }
  | {
      id: string;
      label: ReactNode;
      hint?: ReactNode;
      icon?: ReactNode;
      right?: ReactNode;
      checked?: boolean;
      disabled?: boolean;
      onSelect: () => void;
    };

/** A button that opens a small list of choices. Closes on choice, outside click or Escape. */
export function Menu({
  trigger,
  items,
  className = "chip",
  align = "left",
  up = false,
  width = 280,
  title,
}: {
  trigger: ReactNode;
  items: MenuItem[];
  className?: string;
  align?: "left" | "right";
  /** Open above the button (for the composer, near the bottom of the screen). */
  up?: boolean;
  width?: number;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ up: boolean; maxHeight: number }>({ up, maxHeight: 380 });
  const ref = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  // Open on the side with more room, and cap the height to what fits in the window.
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const above = r.top - 56; // below the title bar
    const below = window.innerHeight - r.bottom - 12;
    // The menu's full height, so it opens where it fits without scrolling.
    const natural = Math.min(420, popRef.current?.scrollHeight ?? 300);
    const goUp = up
      ? above >= natural || (below < natural && above > below)
      : below < natural && above > below;
    setPlace({ up: goUp, maxHeight: Math.max(160, Math.min(420, goUp ? above : below)) });
  }, [open, up]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="menu" ref={ref}>
      <button
        type="button"
        className={className}
        aria-haspopup="menu"
        aria-expanded={open}
        title={title}
        onClick={() => setOpen(!open)}
      >
        {trigger}
      </button>
      {open ? (
        <div
          ref={popRef}
          className={`pop ${place.up ? "up" : ""}`}
          role="menu"
          style={{ width, maxHeight: place.maxHeight, [align === "left" ? "left" : "right"]: 0 }}
        >
          {items.map((it, i) =>
            "header" in it ? (
              <div key={`h${i}`} className="pop-h">
                {it.header}
              </div>
            ) : (
              <button
                key={it.id}
                type="button"
                role="menuitemradio"
                aria-checked={Boolean(it.checked)}
                className="pop-o"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onSelect();
                }}
              >
                <span className="pop-icon">
                  {it.checked ? <span className="tick">✓</span> : it.icon}
                </span>
                <span className="pop-text">
                  <b>{it.label}</b>
                  {it.hint ? <small>{it.hint}</small> : null}
                </span>
                {it.right ? <span className="pop-right">{it.right}</span> : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
