import { showToast } from "./toast";

/**
 * Like Claude Code's terminal: selecting text copies it. Text in the boxes you
 * type into is left alone, so editing works as usual.
 */
export function copyOnSelect(): () => void {
  let last = "";
  const onUp = (e: MouseEvent) => {
    if (e.button !== 0) return;
    // After the click settles, so a click that clears the selection copies nothing.
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection?.toString() ?? "";
      const anchor = selection?.anchorNode;
      const el = anchor instanceof Element ? anchor : anchor?.parentElement;
      if (!text.trim() || el?.closest("input, textarea, [contenteditable='true']")) return;
      if (text === last) return;
      last = text;
      void navigator.clipboard.writeText(text).then(
        () => showToast("Copied"),
        () => undefined,
      );
    }, 10);
  };
  // A new selection can be the same text again (copy it twice in a row).
  const onDown = () => {
    last = "";
  };
  document.addEventListener("mouseup", onUp);
  document.addEventListener("mousedown", onDown);
  return () => {
    document.removeEventListener("mouseup", onUp);
    document.removeEventListener("mousedown", onDown);
  };
}
