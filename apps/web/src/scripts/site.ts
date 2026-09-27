// Theme toggle and copy buttons. Loaded on every page.

const root = document.documentElement;

document.querySelector("[data-theme-toggle]")?.addEventListener("click", () => {
  const next = root.dataset.theme === "light" ? "dark" : "light";
  root.dataset.theme = next;
  try {
    localStorage.setItem("theme", next);
  } catch {
    // Storage can be blocked; the toggle still works for this page view.
  }
});

document.addEventListener("click", (event) => {
  const button = (event.target as Element | null)?.closest<HTMLElement>(
    "[data-copy], [data-copy-from]",
  );
  if (!button) return;
  const from = button.dataset.copyFrom;
  const source = from ? document.getElementById(from) : null;
  // <template> holds the exact file bytes; highlighted markup may not round-trip.
  const text =
    source instanceof HTMLTemplateElement
      ? source.content.textContent
      : (source?.textContent ?? button.dataset.copy);
  if (text == null) return;
  void copy(text).then((ok) => {
    const label = button.querySelector("[data-copy-label]");
    const original = label?.textContent;
    if (label) label.textContent = ok ? "Copied" : "Press ⌘C";
    button.toggleAttribute("data-copied", ok);
    window.setTimeout(() => {
      if (label && original) label.textContent = original;
      button.removeAttribute("data-copied");
    }, 1600);
  });
});

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
