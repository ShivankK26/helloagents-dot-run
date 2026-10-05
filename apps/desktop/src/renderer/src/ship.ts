import type { ShipKind } from "../../shared/api";

/**
 * Whether a follow-up is really a request to ship ("cool push it", "open a PR").
 * The agent can't push, so helloagents does it instead. Only short messages count:
 * a long one ("push the modal down 10px and…") is a task.
 */
export function shipIntent(text: string, inPlace: boolean): ShipKind | null {
  const t = text.trim().toLowerCase();
  if (!t || t.length > 120 || t.includes("\n")) return null;
  const ask =
    /^(?:(?:ok(?:ay)?|cool|great|nice|perfect|awesome|yes|yep|sure|looks good|lgtm|thanks?|also|then|now|and)[\s,!.]*)*(?:(?:can|could|would) you |please |go ahead and |just |also |now |and |then )*/;
  const rest = t.replace(ask, "");
  // "push the code to github", "push my changes": pushing the work, not "push the button down".
  if (
    /^push\b/.test(rest) &&
    !/^push\b.{0,40}\b(?:button|modal|card|footer|header|text|image|icon|div|element|down|up by|left|right)\b/.test(
      rest,
    )
  )
    return /\b(?:pr|pull request)\b/.test(rest) && !inPlace ? "pr" : "push";
  const pr = /\b(?:open|create|raise|make|send)\b.{0,12}\b(?:pr|pull request)\b/.test(rest);
  if (/^push\b/.test(rest) || /^commit and push\b/.test(rest)) return "push";
  if (/^(?:open|create|raise|make)\b/.test(rest) && pr) return inPlace ? "push" : "pr";
  if (/^merge\b/.test(rest)) return inPlace ? null : "merge";
  if (/^commit\b/.test(rest)) return "commit";
  if (/^ship it\b/.test(rest)) return inPlace ? "push" : "pr";
  return null;
}

export const SHIP_LABEL: Record<ShipKind, string> = {
  commit: "Commit",
  push: "Push branch",
  pr: "Open a pull request",
  merge: "Merge",
};

/** A path the agent used, made short: relative to the run's folder, or an attachment's name. */
export function shortPath(p: string, root?: string): string {
  if (root && p.startsWith(`${root}/`)) return p.slice(root.length + 1);
  const attached = /\/helloagents\/attachments\/(?:[0-9a-f]{8}-)?(.+)$/.exec(p);
  if (attached?.[1]) return `${attached[1]} (attached)`;
  return p.replace(/^\/Users\/[^/]+/, "~");
}
