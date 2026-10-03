import type { RunSettings } from "../../shared/api";

export const MODELS: Array<{ id: string; name: string; hint: string; isNew?: boolean }> = [
  { id: "", name: "Default", hint: "Whatever Claude Code is set to use" },
  {
    id: "claude-opus-5-5",
    name: "Opus 5.5",
    hint: "Best for hard, multi-file changes",
    isNew: true,
  },
  { id: "claude-fable-5-1", name: "Fable 5.1", hint: "Most capable, for the toughest tasks" },
  { id: "claude-sonnet-5", name: "Sonnet 5", hint: "Fast and lighter on your plan" },
  { id: "claude-haiku-4-5-20251001", name: "Haiku 4.5", hint: "Quick questions and small edits" },
];

export const EFFORTS: Array<{
  id: NonNullable<RunSettings["effort"]>;
  name: string;
  hint?: string;
}> = [
  { id: "low", name: "Low", hint: "Quick answers" },
  { id: "medium", name: "Medium" },
  { id: "high", name: "High", hint: "Good default for code changes" },
  { id: "xhigh", name: "Extra high" },
  { id: "max", name: "Max", hint: "Slowest, for the hardest problems" },
];

export const modelName = (id?: string) =>
  MODELS.find((m) => m.id === (id ?? ""))?.name ?? id ?? "Default";

const key = (projectId: string) => `helloagents.composer.${projectId}`;

/** The composer remembers its choices per project. */
export function loadSettings(projectId: string): RunSettings {
  try {
    const raw = localStorage.getItem(key(projectId));
    return raw
      ? (JSON.parse(raw) as RunSettings)
      : { effort: "high", access: "edits", workspace: "branch" };
  } catch {
    return { effort: "high", access: "edits", workspace: "branch" };
  }
}

export function saveSettings(projectId: string, s: RunSettings): void {
  try {
    const { base: _base, ...keep } = s;
    localStorage.setItem(key(projectId), JSON.stringify(keep));
  } catch {
    // not remembered
  }
}
