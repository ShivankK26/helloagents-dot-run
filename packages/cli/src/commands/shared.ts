import { suggest } from "../fuzzy.js";
import { CliError } from "../output.js";
import type { RegistryEntry, RegistryIndex } from "../registry.js";

export function typeLabel(type: RegistryEntry["type"]): string {
  return type === "agent" ? "sub-agent" : "skill";
}

/** Looks up each name exactly, failing with suggestions for any that don't exist. */
export function findEntries(index: RegistryIndex, names: string[]): RegistryEntry[] {
  const byName = new Map(index.entries.map((e) => [e.name, e]));
  const unique = [...new Set(names.map((n) => n.trim().toLowerCase()))];
  const missing = unique.filter((n) => !byName.has(n));
  if (missing.length > 0) {
    const allNames = [...byName.keys()];
    const lines = missing.map((name) => {
      const close = suggest(name, allNames);
      return close.length > 0
        ? `Unknown entry "${name}". Did you mean ${formatList(close)}?`
        : `Unknown entry "${name}".`;
    });
    lines.push("Search the registry with: helloagents search <words>");
    throw new CliError(lines.join("\n"));
  }
  return unique.map((n) => byName.get(n) as RegistryEntry);
}

export function formatList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
}
