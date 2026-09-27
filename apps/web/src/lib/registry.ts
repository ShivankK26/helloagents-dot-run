import { loadValidRegistry, toIndex, type LoadedEntry, type LoadedFile } from "@helloagents/schema";
import { CLI, REPO_URL, SITE_URL } from "./site";

export type { LoadedEntry, LoadedFile };

let cached: Promise<LoadedEntry[]> | undefined;

/** All registry entries, validated. Re-read on every call in dev so edits show up live. */
export function getEntries(): Promise<LoadedEntry[]> {
  if (import.meta.env.DEV || !cached) cached = loadValidRegistry(__REGISTRY_DIR__);
  return cached;
}

export async function getIndex() {
  return toIndex(await getEntries());
}

export const typeDir = (type: LoadedEntry["type"]) => (type === "agent" ? "agents" : "skills");
export const typeLabel = (type: LoadedEntry["type"]) => (type === "agent" ? "Sub-agent" : "Skill");

export const entryPath = (e: Pick<LoadedEntry, "type" | "name">) =>
  `/${typeDir(e.type)}/${e.name}/`;
export const rawPath = (file: Pick<LoadedFile, "path">) => `/r/${file.path}`;
export const sourceUrl = (file: Pick<LoadedFile, "path">) =>
  `${REPO_URL}/blob/main/registry/${file.path}`;

export const installCommand = (name: string, global = false) =>
  `${CLI} add ${name}${global ? " --global" : ""}`;

/** A curl command that installs without Node, for people who prefer that. */
export function curlCommand(entry: LoadedEntry): string {
  const pairs = entry.files.map((f) => `${SITE_URL}/r/${f.path} -o .claude/${f.path}`);
  return `curl -fsSL --create-dirs ${pairs.join(" ")}`;
}

/** The part of a file path after the entry's own folder, e.g. references/format.md */
export function shortPath(entry: LoadedEntry, file: LoadedFile): string {
  const prefix = entry.type === "agent" ? "agents/" : `skills/${entry.name}/`;
  return file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
}

export function formatBytes(n: number): string {
  return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
}

const LANGS: Record<string, string> = {
  md: "markdown",
  mdx: "mdx",
  sh: "bash",
  bash: "bash",
  py: "python",
  js: "javascript",
  mjs: "javascript",
  ts: "typescript",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  sql: "sql",
  toml: "toml",
  html: "html",
  css: "css",
};

export function languageFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return LANGS[ext] ?? "plaintext";
}

export function toolsList(entry: LoadedEntry): string | undefined {
  if (entry.type !== "agent") {
    const allowed = entry.frontmatter["allowed-tools"];
    if (typeof allowed === "string") return allowed;
    if (Array.isArray(allowed)) return allowed.join(" ");
    return undefined;
  }
  return entry.tools?.join(", ");
}
