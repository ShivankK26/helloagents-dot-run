import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import {
  MAX_FILE_BYTES,
  MAX_FILES_PER_SKILL,
  PATH_SEGMENT_PATTERN,
  TYPE_DIRS,
  type EntryType,
} from "./constants.js";
import { FrontmatterError, parseMarkdown } from "./frontmatter.js";
import {
  KNOWN_AGENT_FIELDS,
  KNOWN_SKILL_FIELDS,
  agentFrontmatterSchema,
  skillFrontmatterSchema,
} from "./schemas.js";
import { closest } from "./suggest.js";
import type { LoadedEntry, LoadedFile, RegistryIssue } from "./types.js";

export interface LoadResult {
  entries: LoadedEntry[];
  issues: RegistryIssue[];
}

/** Files the OS drops into folders that we silently skip rather than publish. */
const IGNORED_FILES = new Set([".DS_Store", "Thumbs.db"]);

/**
 * Reads and validates every entry under `registryDir`. Never throws for bad
 * content: every problem is collected into `issues` so contributors see them
 * all at once.
 */
export async function loadRegistry(registryDir: string): Promise<LoadResult> {
  const root = path.resolve(registryDir);
  const label = (...parts: string[]) =>
    path.posix.join(path.basename(root), ...parts.flatMap((p) => p.split(path.sep)));
  const issues: RegistryIssue[] = [];
  const entries: LoadedEntry[] = [];

  if (!(await isDirectory(root))) {
    issues.push({ file: label(), message: `registry folder not found at ${root}` });
    return { entries, issues };
  }

  for (const type of ["agent", "skill"] as const) {
    const dir = path.join(root, TYPE_DIRS[type]);
    if (!(await isDirectory(dir))) continue;
    const names = (await readdir(dir)).filter((n) => !IGNORED_FILES.has(n)).sort();
    for (const item of names) {
      const itemPath = path.join(dir, item);
      const rel = label(TYPE_DIRS[type], item);
      const stat = await lstat(itemPath);
      const report = (message: string) => issues.push({ file: rel, message });

      if (type === "agent") {
        if (!stat.isFile() || !item.endsWith(".md")) {
          report("registry/agents/ may only contain <name>.md files");
          continue;
        }
        const entry = await loadAgent(root, item.slice(0, -3), report);
        if (entry) entries.push(entry);
      } else {
        if (!stat.isDirectory()) {
          report(
            "registry/skills/ may only contain folders, one per skill: skills/<name>/SKILL.md",
          );
          continue;
        }
        const entry = await loadSkill(root, item, (message, file) =>
          issues.push({ file: file ? label(TYPE_DIRS.skill, item, file) : rel, message }),
        );
        if (entry) entries.push(entry);
      }
    }
  }

  // Names are the install key (`helloagents add <name>`), so they must be
  // unique across both entry types.
  const seen = new Map<string, LoadedEntry>();
  for (const entry of entries) {
    const prior = seen.get(entry.name);
    if (prior) {
      issues.push({
        file: label(entry.mainPath),
        message: `name "${entry.name}" is already used by ${label(prior.mainPath)}; names must be unique across agents and skills`,
      });
    } else {
      seen.set(entry.name, entry);
    }
  }

  return { entries, issues };
}

type Reporter = (message: string, file?: string) => void;

async function loadAgent(
  root: string,
  expectedName: string,
  report: Reporter,
): Promise<LoadedEntry | undefined> {
  const mainPath = `${TYPE_DIRS.agent}/${expectedName}.md`;
  const file = await readEntryFile(root, mainPath, report);
  if (!file) return undefined;
  return buildEntry("agent", expectedName, mainPath, [file], report);
}

async function loadSkill(
  root: string,
  expectedName: string,
  report: Reporter,
): Promise<LoadedEntry | undefined> {
  const base = `${TYPE_DIRS.skill}/${expectedName}`;
  const relPaths: string[] = [];
  let ok = await walk(path.join(root, base), "", relPaths, report);

  if (!relPaths.includes("SKILL.md")) {
    const wrongCase = relPaths.find((p) => p.toLowerCase() === "skill.md");
    report(
      wrongCase
        ? `rename ${wrongCase} to SKILL.md (the name is case-sensitive)`
        : "skill folder is missing SKILL.md",
    );
    return undefined;
  }
  if (relPaths.length > MAX_FILES_PER_SKILL) {
    report(`a skill may contain at most ${MAX_FILES_PER_SKILL} files (found ${relPaths.length})`);
    ok = false;
  }

  // SKILL.md first, then everything else alphabetically.
  relPaths.sort((a, b) => (a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a.localeCompare(b)));
  const files: LoadedFile[] = [];
  for (const rel of relPaths) {
    const file = await readEntryFile(root, `${base}/${rel}`, (m) => report(m, rel));
    if (file) files.push(file);
    else ok = false;
  }
  if (!ok) return undefined;
  return buildEntry("skill", expectedName, `${base}/SKILL.md`, files, report);
}

/** Collects file paths (posix, relative to the skill folder). Returns false on any problem. */
async function walk(
  dir: string,
  prefix: string,
  out: string[],
  report: Reporter,
): Promise<boolean> {
  let ok = true;
  for (const item of (await readdir(dir)).sort()) {
    if (IGNORED_FILES.has(item)) continue;
    const rel = prefix ? `${prefix}/${item}` : item;
    if (!PATH_SEGMENT_PATTERN.test(item)) {
      report(
        item.startsWith(".")
          ? "hidden files are not allowed in a skill"
          : "file names may only use letters, digits, '.', '_' and '-'",
        rel,
      );
      ok = false;
      continue;
    }
    const stat = await lstat(path.join(dir, item));
    if (stat.isSymbolicLink()) {
      report("symlinks are not allowed; copy the file in instead", rel);
      ok = false;
    } else if (stat.isDirectory()) {
      ok = (await walk(path.join(dir, item), rel, out, report)) && ok;
    } else if (stat.isFile()) {
      out.push(rel);
    }
  }
  return ok;
}

async function readEntryFile(
  root: string,
  relPath: string,
  report: Reporter,
): Promise<LoadedFile | undefined> {
  const data = await readFile(path.join(root, relPath));
  if (data.length > MAX_FILE_BYTES) {
    report(
      `file is ${Math.ceil(data.length / 1024)} KiB; the limit is ${MAX_FILE_BYTES / 1024} KiB`,
    );
    return undefined;
  }
  const file: LoadedFile = {
    path: relPath,
    size: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
    data,
  };
  const text = decodeText(data);
  if (text !== undefined) file.text = text;
  return file;
}

function decodeText(data: Buffer): string | undefined {
  if (data.includes(0)) return undefined;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return undefined;
  }
}

function buildEntry(
  type: EntryType,
  expectedName: string,
  mainPath: string,
  files: LoadedFile[],
  report: Reporter,
): LoadedEntry | undefined {
  const main = files.find((f) => f.path === mainPath);
  const mainFile = type === "skill" ? "SKILL.md" : undefined;
  const reportMain = (m: string) => report(m, mainFile);
  if (main?.text === undefined) {
    reportMain("must be a UTF-8 text file");
    return undefined;
  }

  let parsed;
  try {
    parsed = parseMarkdown(main.text);
  } catch (error) {
    if (error instanceof FrontmatterError) {
      reportMain(error.message);
      return undefined;
    }
    throw error;
  }

  let ok = true;
  const known = type === "agent" ? KNOWN_AGENT_FIELDS : KNOWN_SKILL_FIELDS;
  for (const key of Object.keys(parsed.data)) {
    if (known.includes(key)) continue;
    // Claude Code silently ignores unknown fields, which hides typos. Catch them here.
    const hint = closest(key, known);
    reportMain(`unknown frontmatter field "${key}"${hint ? ` (did you mean "${hint}"?)` : ""}`);
    ok = false;
  }

  const schema = type === "agent" ? agentFrontmatterSchema : skillFrontmatterSchema;
  const result = schema.safeParse(parsed.data);
  if (!result.success) {
    for (const issue of result.error.issues) reportMain(formatIssue(issue, parsed.data));
    return undefined;
  }
  const fm = result.data;

  if (fm.name !== expectedName) {
    const where =
      type === "agent" ? `file name "${expectedName}.md"` : `folder name "${expectedName}"`;
    reportMain(`name "${fm.name}" must match the ${where}`);
    ok = false;
  }
  if (parsed.body.trim().length === 0) {
    reportMain(
      type === "agent"
        ? "the system prompt (text after the frontmatter) is empty"
        : "the instructions (text after the frontmatter) are empty",
    );
    ok = false;
  }
  if (!ok) return undefined;

  const entry: LoadedEntry = {
    name: fm.name,
    type,
    description: fm.description,
    tags: fm.tags ?? [],
    mainPath,
    frontmatter: parsed.data,
    body: parsed.body,
    files,
  };
  if (fm.category) entry.category = fm.category;
  if (fm.author) entry.author = fm.author;
  if (fm.model) entry.model = fm.model;
  if (type === "agent" && "tools" in fm && fm.tools) {
    entry.tools =
      typeof fm.tools === "string" ? fm.tools.split(",").map((t) => t.trim()) : fm.tools;
  }
  return entry;
}

function formatIssue(issue: z.core.$ZodIssue, data: Record<string, unknown>): string {
  const field = issue.path.map(String).join(".");
  if (!field) return issue.message;
  const missing = issue.path.length === 1 && data[field] === undefined;
  if (missing) return `frontmatter field "${field}" is required`;
  return `frontmatter field "${field}" ${issue.message.charAt(0).toLowerCase()}${issue.message.slice(1)}`;
}

async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await lstat(p)).isDirectory();
  } catch {
    return false;
  }
}
