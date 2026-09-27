import type { EntryType } from "./constants.js";

/** One file an entry ships. `path` is relative to the registry root and to `.claude/`. */
export interface RegistryFile {
  path: string;
  size: number;
  sha256: string;
}

/** An entry as published in registry.json. */
export interface RegistryEntry {
  name: string;
  type: EntryType;
  description: string;
  category?: string;
  tags: string[];
  author?: string;
  /** Sub-agents only: tool allowlist from frontmatter. */
  tools?: string[];
  model?: string;
  files: RegistryFile[];
}

/** The shape of /r/registry.json. */
export interface RegistryIndex {
  version: number;
  entries: RegistryEntry[];
}

export interface LoadedFile extends RegistryFile {
  data: Buffer;
  /** UTF-8 contents, present for text files only. */
  text?: string;
}

/** An entry with its file contents, for the web build. */
export interface LoadedEntry extends Omit<RegistryEntry, "files"> {
  /** Path of the main file: agents/<name>.md or skills/<name>/SKILL.md. */
  mainPath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  files: LoadedFile[];
}

export interface RegistryIssue {
  /** Path relative to the repo root, e.g. registry/agents/foo.md */
  file: string;
  message: string;
}
