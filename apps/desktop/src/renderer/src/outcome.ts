import type { RunStage } from "@helloagents/engine/views";
import type { RunListItem } from "../../shared/api";
import { elapsed } from "./time";

export type Tone = "live" | "ok" | "bad" | "muted";

export interface Outcome {
  tone: Tone;
  /** Short status for a pill: "Done", "Tests failing". */
  label: string;
  /** One line on how it went: "2 files changed · tests pass". */
  line: string;
}

export const STAGES: Array<{ id: RunStage; label: string; doing: string }> = [
  { id: "read", label: "Read the code", doing: "Reading the code" },
  { id: "edit", label: "Make the change", doing: "Making the change" },
  { id: "test", label: "Run the tests", doing: "Running the tests" },
  { id: "wrap", label: "Wrap up", doing: "Wrapping up" },
];

const FAILED: Record<string, string> = {
  budget: "Hit a limit",
  refused: "Declined",
  context_full: "Ran out of context",
};

/**
 * How a run ended, judged by what happened rather than by the agent's own
 * "done": a run whose last tests failed says so.
 */
export function outcomeOf(run: RunListItem): Outcome {
  const d = run.digest;
  if (run.active) {
    const stage = STAGES.find((s) => s.id === d.stage) ?? STAGES[0];
    return { tone: "live", label: "Working", line: `${stage?.doing ?? "Working"}…` };
  }
  if (run.status === "cancelled")
    return { tone: "muted", label: "Stopped", line: "Stopped before it finished" };
  if (run.status !== "done") {
    return {
      tone: "bad",
      label: FAILED[run.status] ?? "Failed",
      line: run.summary ?? run.error ?? "Didn't finish",
    };
  }
  if (d.tests && !d.tests.passed) {
    const counts = d.tests.line === "failed" ? "" : ` · ${d.tests.line}`;
    return { tone: "bad", label: "Tests failing", line: `Tests failing${counts}` };
  }
  const files = d.filesChanged.length;
  const tests = d.tests
    ? ` · tests pass${d.tests.line === "passed" ? "" : ` (${d.tests.line})`}`
    : "";
  if (files)
    return {
      tone: "ok",
      label: "Done",
      line: `${files} file${files === 1 ? "" : "s"} changed${tests}`,
    };
  const took = run.endedAt ? ` in ${elapsed(run.startedAt, run.endedAt)}` : "";
  return { tone: "ok", label: "Done", line: `Answered${took}${tests}` };
}
