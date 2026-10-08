import type { RunTab } from "./components/RunScreen";
import type { Section } from "./components/Sidebar";

export type Screen =
  | { kind: "home" }
  | { kind: "run"; runId: string; tab: RunTab }
  | { kind: "section"; section: Section };

/** One open tab in the title bar: a screen, and the project it belongs to. */
export interface Tab {
  id: string;
  screen: Screen;
  projectId?: string;
}

export interface Tabs {
  tabs: Tab[];
  active: string;
}

const KEY = "helloagents.tabs";

export const newTab = (screen: Screen, projectId?: string): Tab => ({
  id: crypto.randomUUID(),
  screen,
  ...(projectId && { projectId }),
});

const isTab = (t: unknown): t is Tab => {
  const tab = t as Tab | null;
  return Boolean(tab && typeof tab.id === "string" && tab.screen && "kind" in tab.screen);
};

/** The tabs that were open when the app last closed, or one New task tab. */
export function loadTabs(): Tabs {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "null") as Tabs | null;
    const tabs = Array.isArray(saved?.tabs) ? saved.tabs.filter(isTab) : [];
    const first = tabs[0];
    if (saved && first)
      return { tabs, active: tabs.some((t) => t.id === saved.active) ? saved.active : first.id };
  } catch {
    // start fresh
  }
  const first = newTab({ kind: "home" });
  return { tabs: [first], active: first.id };
}

export function saveTabs(state: Tabs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // not remembered
  }
}

/** Closes a tab; the one to its right (or left) becomes current. Never leaves zero tabs. */
export function closeTab(state: Tabs, id: string): Tabs {
  const at = state.tabs.findIndex((t) => t.id === id);
  if (at < 0) return state;
  const tabs = state.tabs.filter((t) => t.id !== id);
  if (!tabs.length) {
    const home = newTab({ kind: "home" }, state.tabs[at]?.projectId);
    return { tabs: [home], active: home.id };
  }
  const next = tabs[at] ?? tabs[at - 1];
  return { tabs, active: state.active === id && next ? next.id : state.active };
}
