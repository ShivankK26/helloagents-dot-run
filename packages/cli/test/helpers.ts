import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, vi } from "vitest";
import type { Io } from "../src/io.js";
import type { RegistryEntry, RegistryIndex } from "../src/registry.js";

const created: string[] = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "helloagents-cli-"));
  created.push(dir);
  return dir;
}

export interface FakeEntry {
  name: string;
  type: RegistryEntry["type"];
  description?: string;
  tags?: string[];
  category?: string;
  /** Paths relative to the registry root, e.g. agents/foo.md */
  files: Record<string, string>;
}

export const agentFile = (name: string, prompt = "You review code.") =>
  `---\nname: ${name}\ndescription: ${name}\n---\n\n${prompt}\n`;

export const DEFAULT_ENTRIES: FakeEntry[] = [
  {
    name: "code-reviewer",
    type: "agent",
    description: "Reviews code changes for bugs and security problems.",
    tags: ["review", "quality"],
    category: "code-quality",
    files: { "agents/code-reviewer.md": agentFile("code-reviewer") },
  },
  {
    name: "debugger",
    type: "agent",
    description: "Finds the root cause of failing tests and crashes.",
    tags: ["debugging"],
    category: "debugging",
    files: { "agents/debugger.md": agentFile("debugger") },
  },
  {
    name: "changelog",
    type: "skill",
    description: "Writes CHANGELOG entries from git history.",
    tags: ["git", "release"],
    category: "git",
    files: {
      "skills/changelog/SKILL.md": "---\nname: changelog\ndescription: x\n---\nSteps.\n",
      "skills/changelog/references/format.md": "# Format\n",
    },
  },
  {
    name: "sql-helper",
    type: "skill",
    description: "Writes and optimizes SQL queries for Postgres and MySQL.",
    tags: ["sql", "database"],
    category: "data",
    files: { "skills/sql-helper/SKILL.md": "---\nname: sql-helper\ndescription: x\n---\nSQL.\n" },
  },
];

export function buildFakeRegistry(entries: FakeEntry[] = DEFAULT_ENTRIES) {
  const files = new Map<string, string>();
  const index: RegistryIndex = {
    version: 1,
    entries: entries.map((e) => ({
      name: e.name,
      type: e.type,
      description: e.description ?? `${e.name} description`,
      tags: e.tags ?? [],
      ...(e.category && { category: e.category }),
      files: Object.entries(e.files).map(([p, content]) => {
        files.set(p, content);
        return {
          path: p,
          size: Buffer.byteLength(content),
          sha256: createHash("sha256").update(content).digest("hex"),
        };
      }),
    })),
  };
  files.set("registry.json", JSON.stringify(index));
  return { index, files };
}

export const BASE = "https://helloagents.run/r";

/** A fetch mock that serves files from `files` under `base`. */
export function fakeFetch(files: Map<string, string>, base = BASE) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    const rel = url.startsWith(`${base}/`) ? url.slice(base.length + 1) : undefined;
    const body = rel === undefined ? undefined : files.get(rel);
    return body === undefined ? new Response("Not found", { status: 404 }) : new Response(body);
  });
}

export interface TestIo extends Io {
  stdout: string[];
  stderr: string[];
  questions: string[];
  /** Everything printed, joined. */
  output: () => string;
}

export async function testIo(
  options: {
    files?: Map<string, string>;
    fetch?: typeof fetch;
    interactive?: boolean;
    answers?: boolean[];
    env?: Record<string, string>;
  } = {},
): Promise<TestIo> {
  const root = await tempDir();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const questions: string[] = [];
  const answers = [...(options.answers ?? [])];
  const files = options.files ?? buildFakeRegistry().files;
  return {
    cwd: path.join(root, "project"),
    home: path.join(root, "home"),
    env: options.env ?? {},
    fetch: options.fetch ?? (fakeFetch(files) as unknown as typeof fetch),
    out: (t) => stdout.push(t),
    err: (t) => stderr.push(t),
    interactive: options.interactive ?? false,
    confirm: async (q) => {
      questions.push(q);
      const answer = answers.shift();
      if (answer === undefined) throw new Error(`Unexpected prompt: ${q}`);
      return answer;
    },
    color: false,
    columns: 100,
    stdout,
    stderr,
    questions,
    output: () => [...stdout, ...stderr].join("\n"),
  };
}
