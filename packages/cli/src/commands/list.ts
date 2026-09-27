import { access } from "node:fs/promises";
import type { Io } from "../io.js";
import { plural, truncate, type Style } from "../output.js";
import { claudeDir, localPath } from "../paths.js";
import { fetchIndex, type RegistryEntry } from "../registry.js";

export interface ListOptions {
  type?: RegistryEntry["type"];
  json: boolean;
}

export async function list(io: Io, style: Style, options: ListOptions): Promise<number> {
  const index = await fetchIndex(io);
  const entries = index.entries.filter((e) => !options.type || e.type === options.type);
  if (options.json) {
    io.out(JSON.stringify(entries, null, 2));
    return 0;
  }
  await printEntries(io, style, entries);
  io.out("");
  io.out(style.dim("Install with: helloagents add <name>   ·   Browse at https://helloagents.run"));
  return 0;
}

export async function printEntries(io: Io, style: Style, entries: RegistryEntry[]): Promise<void> {
  const width = Math.max(...entries.map((e) => e.name.length), 4) + 2;
  const installed = await installedNames(io, entries);
  const groups: [string, RegistryEntry[]][] = [
    ["Sub-agents", entries.filter((e) => e.type === "agent")],
    ["Skills", entries.filter((e) => e.type === "skill")],
  ];
  let first = true;
  for (const [title, group] of groups) {
    if (group.length === 0) continue;
    if (!first) io.out("");
    first = false;
    io.out(style.bold(`${title} (${group.length})`));
    for (const entry of group) {
      const mark = installed.has(entry.name) ? style.green("✓") : " ";
      const descWidth = io.columns - width - 4;
      io.out(
        `${mark} ${style.cyan(entry.name.padEnd(width))}${style.dim(truncate(entry.description, descWidth))}`,
      );
    }
  }
  if (installed.size > 0) {
    io.out("");
    io.out(
      style.dim(`${style.green("✓")} installed (${plural(installed.size, "entry", "entries")})`),
    );
  }
}

async function installedNames(io: Io, entries: RegistryEntry[]): Promise<Set<string>> {
  const roots = [claudeDir(io, "project"), claudeDir(io, "global")];
  const found = new Set<string>();
  await Promise.all(
    entries.map(async (entry) => {
      const main = entry.files[0];
      if (!main) return;
      for (const root of roots) {
        try {
          await access(localPath(root, main.path));
          found.add(entry.name);
          return;
        } catch {
          // not installed here
        }
      }
    }),
  );
  return found;
}
