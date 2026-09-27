import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { REGISTRY_FORMAT_VERSION } from "./constants.js";
import { loadRegistry } from "./load.js";
import type { LoadedEntry, RegistryEntry, RegistryIndex, RegistryIssue } from "./types.js";

export class RegistryValidationError extends Error {
  constructor(readonly issues: RegistryIssue[]) {
    super(formatIssues(issues));
    this.name = "RegistryValidationError";
  }
}

export function formatIssues(issues: RegistryIssue[]): string {
  const byFile = new Map<string, string[]>();
  for (const { file, message } of issues) {
    byFile.set(file, [...(byFile.get(file) ?? []), message]);
  }
  const count = issues.length === 1 ? "1 problem" : `${issues.length} problems`;
  const lines = [`Registry validation failed with ${count}:`, ""];
  for (const [file, messages] of byFile) {
    lines.push(`  ${file}`);
    for (const message of messages) lines.push(`    ✖ ${message}`);
    lines.push("");
  }
  return lines.join("\n");
}

/** Loads the registry and throws a RegistryValidationError listing every problem. */
export async function loadValidRegistry(registryDir: string): Promise<LoadedEntry[]> {
  const { entries, issues } = await loadRegistry(registryDir);
  if (issues.length > 0) throw new RegistryValidationError(issues);
  return sortEntries(entries);
}

export function toIndex(entries: LoadedEntry[]): RegistryIndex {
  return {
    version: REGISTRY_FORMAT_VERSION,
    entries: sortEntries(entries).map((e): RegistryEntry => ({
      name: e.name,
      type: e.type,
      description: e.description,
      ...(e.category && { category: e.category }),
      tags: e.tags,
      ...(e.author && { author: e.author }),
      ...(e.tools && { tools: e.tools }),
      ...(e.model && { model: e.model }),
      files: e.files.map(({ path, size, sha256 }) => ({ path, size, sha256 })),
    })),
  };
}

export interface BuildOptions {
  registryDir: string;
  outDir: string;
}

/**
 * Validates the registry and writes `registry.json` plus one raw copy of every
 * entry file to `outDir`, mirroring the registry layout:
 *   <out>/registry.json
 *   <out>/agents/<name>.md
 *   <out>/skills/<name>/<file>
 */
export async function buildRegistry({ registryDir, outDir }: BuildOptions): Promise<RegistryIndex> {
  const entries = await loadValidRegistry(registryDir);
  const index = toIndex(entries);
  const out = path.resolve(outDir);

  // Only clear what we own, in case outDir is shared (e.g. a public/ folder).
  await Promise.all(
    ["registry.json", "agents", "skills"].map((p) =>
      rm(path.join(out, p), { recursive: true, force: true }),
    ),
  );
  await mkdir(out, { recursive: true });
  for (const entry of entries) {
    for (const file of entry.files) {
      const dest = path.join(out, ...file.path.split("/"));
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, file.data);
    }
  }
  await writeFile(path.join(out, "registry.json"), `${JSON.stringify(index, null, 2)}\n`);
  return index;
}

function sortEntries<T extends { type: string; name: string }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
}
