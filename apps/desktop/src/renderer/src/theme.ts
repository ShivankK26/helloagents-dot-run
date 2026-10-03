import type { ThemeMode } from "../../shared/api";

const KEY = "helloagents.theme";

export function savedTheme(): ThemeMode {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

/** Paints the page in light or dark and tells the window (for its background and controls). */
export function applyTheme(mode: ThemeMode): "light" | "dark" {
  const resolved = mode === "system" ? (systemDark() ? "dark" : "light") : mode;
  document.documentElement.dataset.theme = resolved;
  try {
    if (mode === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, mode);
  } catch {
    // not remembered; still applied
  }
  void window.helloagents?.setTheme(mode);
  return resolved;
}

/** Follows the system setting while the user hasn't picked one. */
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
