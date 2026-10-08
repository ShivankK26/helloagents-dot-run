import { type PointerEvent, type RefObject, useLayoutEffect, useState } from "react";

const key = (name: string) => `helloagents.box.${name}`;
const max = () => Math.max(120, Math.round(window.innerHeight * 0.6));

function loadHeight(name: string): number | null {
  try {
    const saved = Number(localStorage.getItem(key(name)));
    return saved > 0 ? saved : null;
  } catch {
    return null;
  }
}

function saveHeight(name: string, h: number | null): void {
  try {
    if (h === null) localStorage.removeItem(key(name));
    else localStorage.setItem(key(name), String(Math.round(h)));
  } catch {
    // not remembered
  }
}

/** Sizes the box to its text, or to the height it was dragged to. */
function fitBox(el: HTMLTextAreaElement, manual: number | null): void {
  // Measure with the CSS height, then with no height, without animating.
  const transition = el.style.transition;
  el.style.transition = "none";
  el.style.height = "";
  const base = el.offsetHeight;
  el.style.height = "0px";
  const natural = el.scrollHeight;
  if (manual === null && natural <= base) el.style.height = "";
  else el.style.height = `${Math.min(manual ?? Math.max(natural, base), max())}px`;
  void el.offsetHeight;
  el.style.transition = transition;
}

/**
 * A text box that grows as you type and can be dragged taller or shorter by a
 * grip. `edge` is where the grip sits: "bottom" grows down, "top" grows up.
 * The dragged height is remembered; double-click the grip to go back.
 */
export function useGrowBox(
  box: RefObject<HTMLTextAreaElement | null>,
  value: string,
  name: string,
  edge: "top" | "bottom",
) {
  const [manual, setManual] = useState<number | null>(() => loadHeight(name));

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => fitBox(el, manual);
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [box, value, manual]);

  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (e.button !== 0 || !el) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = el.offsetHeight;
    const sign = edge === "bottom" ? 1 : -1;
    let last = startH;
    document.body.classList.add("resizing");
    const move = (ev: globalThis.PointerEvent) => {
      last = Math.min(Math.max(48, startH + sign * (ev.clientY - startY)), max());
      setManual(last);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("resizing");
      saveHeight(name, last);
      el.focus({ preventScroll: true });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  const reset = () => {
    setManual(null);
    saveHeight(name, null);
  };

  return (
    <div
      className={`box-grip ${edge}`}
      title="Drag to resize · double-click to reset"
      onPointerDown={drag}
      onDoubleClick={reset}
    />
  );
}
