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
    const saved = raw ? (JSON.parse(raw) as RunSettings) : null;
    // Auto became the default; "edits" saved before then was the old default, not a choice.
    if (saved && saved.access === "edits" && !localStorage.getItem(`${key(projectId)}.mode`))
      saved.access = "auto";
    return saved ?? { effort: "high", access: "auto", workspace: "branch" };
  } catch {
    return { effort: "high", access: "auto", workspace: "branch" };
  }
}

/** Modes, like Claude Code's: how much the agent may do before asking. */
export const MODES = [
  { id: "auto", name: "Auto", hint: "Does safe things itself; asks only about risky ones" },
  {
    id: "edits",
    name: "Ask for commands",
    hint: "Edits files and runs build and test commands; asks before anything else",
  },
  { id: "plan", name: "Plan first", hint: "Reads and plans, then asks before changing anything" },
  { id: "full", name: "Full access", hint: "Never asks. Still on its own branch" },
] as const;

export const modeName = (access?: string) =>
  MODES.find((m) => m.id === (access ?? "auto"))?.name ?? "Auto";

export function saveSettings(projectId: string, s: RunSettings): void {
  try {
    localStorage.setItem(`${key(projectId)}.mode`, "1");
  } catch {
    // not remembered
  }
  try {
    const { base: _base, ...keep } = s;
    localStorage.setItem(key(projectId), JSON.stringify(keep));
  } catch {
    // not remembered
  }
}
