import { suggest } from "../fuzzy.js";
import type { Io } from "../io.js";
import { CliError, plural, type Style } from "../output.js";
import { fetchIndex, type RegistryEntry } from "../registry.js";
import { printEntries } from "./list.js";
import { formatList } from "./shared.js";

export interface SearchOptions {
  query: string;
  json: boolean;
}

export async function search(io: Io, style: Style, options: SearchOptions): Promise<number> {
  const terms = options.query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    throw new CliError("Give me something to search for, e.g. helloagents search review", 2);
  }
  const index = await fetchIndex(io);
  const results = rank(index.entries, terms);

  if (options.json) {
    io.out(JSON.stringify(results, null, 2));
    return 0;
  }
  if (results.length === 0) {
    const close = suggest(
      terms.join("-"),
      index.entries.map((e) => e.name),
    );
    io.out(`No entries match "${options.query}".`);
    if (close.length > 0) io.out(`Did you mean ${formatList(close)}?`);
    io.out(style.dim("See everything with: helloagents list"));
    return 1;
  }
  io.out(style.dim(`${plural(results.length, "match", "matches")} for "${options.query}"`));
  io.out("");
  await printEntries(io, style, results);
  io.out("");
  io.out(style.dim("Install with: helloagents add <name>"));
  return 0;
}

/** Every term must match somewhere; names and tags weigh more than descriptions. */
export function rank(entries: RegistryEntry[], terms: string[]): RegistryEntry[] {
  const scored = entries.map((entry) => {
    const name = entry.name;
    const tags = entry.tags.join(" ");
    const category = entry.category ?? "";
    const description = entry.description.toLowerCase();
    let score = 0;
    for (const term of terms) {
      let s = 0;
      if (name === term) s = 100;
      else if (name.startsWith(term)) s = 60;
      else if (name.includes(term)) s = 40;
      else if (entry.tags.includes(term)) s = 30;
      else if (tags.includes(term) || category.includes(term)) s = 20;
      else if (description.includes(term)) s = 10;
      else if (term === "agent" || term === "agents" || term === "subagent")
        s = entry.type === "agent" ? 5 : 0;
      else if (term === "skill" || term === "skills") s = entry.type === "skill" ? 5 : 0;
      if (s === 0) return { entry, score: 0 };
      score += s;
    }
    return { entry, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.localeCompare(b.entry.name))
    .map((s) => s.entry);
}
