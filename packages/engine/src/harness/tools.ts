import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { displayPath, OutsideWorkspaceError, resolveInside } from "./workspace";

export interface ToolContext {
  workspace: string;
  /** Programs run_command may start. */
  allowedCommands: readonly string[];
  signal?: AbortSignal;
}

export interface ToolOutcome {
  ok: boolean;
  output: string;
  /** Set by `finish`: the agent's own summary of what it did. */
  finished?: string;
}

interface ToolSpec<S extends z.ZodType> {
  name: string;
  description: string;
  schema: S;
  run: (input: z.infer<S>, ctx: ToolContext) => Promise<ToolOutcome>;
}

const tool = <S extends z.ZodType>(spec: ToolSpec<S>) => spec;

export const DEFAULT_ALLOWED_COMMANDS = [
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "bun",
  "deno",
  "python",
  "python3",
  "pip",
  "pytest",
  "uv",
  "go",
  "cargo",
  "make",
  "git",
  "tsc",
  "vitest",
  "jest",
] as const;

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "out",
  "build",
  ".next",
  ".venv",
  "__pycache__",
  ".helloagents",
]);
const MAX_READ_BYTES = 200_000;
const MAX_OUTPUT_CHARS = 12_000;
const MAX_LIST_ENTRIES = 400;

const ok = (output: string): ToolOutcome => ({ ok: true, output });
const fail = (output: string): ToolOutcome => ({ ok: false, output });

const listFiles = tool({
  name: "list_files",
  description:
    "List files and folders in the workspace. Call this first to get oriented, and whenever you need to find where something lives. Skips .git, node_modules and build output.",
  schema: z.object({
    path: z.string().default(".").describe("Folder to list, relative to the workspace root"),
    depth: z.number().int().min(1).max(5).default(2).describe("How many levels deep to go"),
  }),
  async run({ path: p, depth }, ctx) {
    const root = await resolveInside(ctx.workspace, p);
    const lines: string[] = [];
    const walk = async (dir: string, level: number): Promise<void> => {
      if (lines.length >= MAX_LIST_ENTRIES) return;
      const entries = (await readdir(dir, { withFileTypes: true })).sort((a, b) =>
        a.name.localeCompare(b.name),
      );
      for (const e of entries) {
        if (lines.length >= MAX_LIST_ENTRIES) return;
        if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        lines.push(`${"  ".repeat(level)}${e.name}${e.isDirectory() ? "/" : ""}`);
        if (e.isDirectory() && level + 1 < depth) await walk(full, level + 1);
      }
    };
    await walk(root, 0);
    if (lines.length === 0)
      return ok(`${displayPath(await realpath(ctx.workspace), root)} is empty`);
    const more =
      lines.length >= MAX_LIST_ENTRIES
        ? `\n… stopped at ${MAX_LIST_ENTRIES} entries; list a subfolder to see more`
        : "";
    return ok(lines.join("\n") + more);
  },
});

const readFileTool = tool({
  name: "read_file",
  description:
    "Read a text file. Read a file before you edit it so your edit matches its exact current contents. Output has line numbers, which are not part of the file.",
  schema: z.object({
    path: z.string().describe("File path relative to the workspace root"),
    start_line: z.number().int().min(1).optional().describe("First line to read (1-based)"),
    end_line: z.number().int().min(1).optional().describe("Last line to read (inclusive)"),
  }),
  async run({ path: p, start_line, end_line }, ctx) {
    const file = await resolveInside(ctx.workspace, p);
    const buf = await readFile(file);
    if (buf.length > MAX_READ_BYTES && !start_line) {
      return fail(
        `${p} is ${Math.round(buf.length / 1024)} KB. Read part of it with start_line and end_line.`,
      );
    }
    if (buf.includes(0)) return fail(`${p} looks like a binary file`);
    const all = buf.toString("utf8").split("\n");
    const from = (start_line ?? 1) - 1;
    const to = Math.min(end_line ?? all.length, all.length);
    const width = String(to).length;
    const body = all
      .slice(from, to)
      .map((l, i) => `${String(from + i + 1).padStart(width)} | ${l}`)
      .join("\n");
    return ok(body || "(empty file)");
  },
});

const writeFileTool = tool({
  name: "write_file",
  description:
    "Create a new file, or replace a whole file. For changing part of an existing file, use edit_file instead.",
  schema: z.object({
    path: z.string().describe("File path relative to the workspace root"),
    content: z.string().describe("The complete file contents"),
  }),
  async run({ path: p, content }, ctx) {
    const file = await resolveInside(ctx.workspace, p);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content);
    return ok(
      `Wrote ${displayPath(await realpath(ctx.workspace), file)} (${content.split("\n").length} lines)`,
    );
  },
});

const editFile = tool({
  name: "edit_file",
  description:
    "Change part of a file by replacing one exact piece of text. old_text must appear exactly once in the file, including whitespace and indentation; include a few surrounding lines to make it unique.",
  schema: z.object({
    path: z.string().describe("File path relative to the workspace root"),
    old_text: z.string().min(1).describe("Exact text to replace; must occur exactly once"),
    new_text: z.string().describe("Text to put in its place"),
  }),
  async run({ path: p, old_text, new_text }, ctx) {
    const file = await resolveInside(ctx.workspace, p);
    const text = await readFile(file, "utf8");
    const count = text.split(old_text).length - 1;
    if (count === 0)
      return fail(`old_text was not found in ${p}. Read the file again and copy the text exactly.`);
    if (count > 1)
      return fail(
        `old_text appears ${count} times in ${p}. Include more surrounding lines so it matches once.`,
      );
    await writeFile(
      file,
      text.replace(old_text, () => new_text),
    );
    return ok(`Edited ${displayPath(await realpath(ctx.workspace), file)}`);
  },
});

const runCommand = tool({
  name: "run_command",
  description:
    "Run a program in the workspace, for example tests (`npm test`, `pytest`) or a build. There is no shell: pass the program and its arguments separately, and don't use pipes, && or redirects. Use this to check your change actually works.",
  schema: z.object({
    command: z.string().describe("Program to run, e.g. npm, node, pytest"),
    args: z.array(z.string()).default([]).describe("Arguments, one per item"),
    timeout_seconds: z.number().int().min(1).max(600).default(120),
  }),
  async run({ command, args, timeout_seconds }, ctx) {
    if (!ctx.allowedCommands.includes(command)) {
      return fail(
        `"${command}" isn't allowed. Allowed programs: ${ctx.allowedCommands.join(", ")}.`,
      );
    }
    return execute(command, args, {
      cwd: await realpath(ctx.workspace),
      timeoutMs: timeout_seconds * 1000,
      signal: ctx.signal,
    });
  },
});

const finish = tool({
  name: "finish",
  description:
    "Call this once, when the task is completely done (or you've done everything you can). Summarize what you changed and how you checked it.",
  schema: z.object({
    summary: z
      .string()
      .min(1)
      .describe("What you changed, how you verified it, and anything left undone"),
  }),
  async run({ summary }) {
    return { ok: true, output: "Finished.", finished: summary };
  },
});

export const TOOLS = [listFiles, readFileTool, writeFileTool, editFile, runCommand, finish];
type AnyTool = ToolSpec<z.ZodType>;
const BY_NAME = new Map<string, AnyTool>(TOOLS.map((t) => [t.name, t as unknown as AnyTool]));

/** Tool definitions in the shape the Messages API expects. */
export function toolDefinitions(): Anthropic.Beta.BetaTool[] {
  return TOOLS.map((t) => {
    const { $schema, ...schema } = z.toJSONSchema(t.schema, { io: "input" }) as Record<
      string,
      unknown
    >;
    return {
      name: t.name,
      description: t.description,
      input_schema: schema as Anthropic.Beta.BetaTool.InputSchema,
      // Stream large inputs (file contents) as they're generated. The API then
      // doesn't validate them, so every input is validated below before use.
      eager_input_streaming: true,
    };
  });
}

/** Validates and runs one tool call. Never throws: failures become error results the model can read. */
export async function runTool(
  name: string,
  input: unknown,
  ctx: ToolContext,
): Promise<ToolOutcome> {
  const spec = BY_NAME.get(name);
  if (!spec) return fail(`Unknown tool "${name}".`);
  const parsed = spec.schema.safeParse(input);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((i) => `${i.path.join(".") || "input"}: ${i.message}`)
      .join("; ");
    return fail(`Invalid input for ${name}: ${problems}. Received: ${JSON.stringify(input)}`);
  }
  try {
    return await spec.run(parsed.data, ctx);
  } catch (error) {
    if (error instanceof OutsideWorkspaceError) return fail(error.message);
    const e = error as NodeJS.ErrnoException;
    if (e.code === "ENOENT")
      return fail(`No such file or folder: ${(input as { path?: string }).path ?? ""}`);
    if (e.code === "EISDIR") return fail(`That's a folder. Use list_files to see what's inside.`);
    return fail(`${name} failed: ${e.message}`);
  }
}

/** Environment for commands the agent runs: everything except secrets. */
export function safeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(env)) {
    if (/KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL/i.test(k)) continue;
    out[k] = v;
  }
  return out;
}

function execute(
  command: string,
  args: string[],
  { cwd, timeoutMs, signal }: { cwd: string; timeoutMs: number; signal?: AbortSignal },
): Promise<ToolOutcome> {
  return new Promise((resolve) => {
    let output = "";
    let timedOut = false;
    const child = spawn(command, args, { cwd, env: safeEnv(), shell: false, signal });
    const collect = (chunk: Buffer) => {
      output += chunk.toString("utf8");
      // Keep the tail: the end of test output is where failures are summarized.
      if (output.length > MAX_OUTPUT_CHARS * 2) output = output.slice(-MAX_OUTPUT_CHARS * 2);
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (e: NodeJS.ErrnoException) => {
      clearTimeout(timer);
      resolve(
        fail(
          e.code === "ENOENT"
            ? `"${command}" isn't installed on this machine.`
            : `Couldn't run ${command}: ${e.message}`,
        ),
      );
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const trimmed =
        output.length > MAX_OUTPUT_CHARS
          ? `… (earlier output cut)\n${output.slice(-MAX_OUTPUT_CHARS)}`
          : output;
      if (timedOut)
        return resolve(fail(`Stopped after ${timeoutMs / 1000}s (timeout).\n${trimmed}`));
      const status = `exit code ${code ?? "unknown"}`;
      resolve({ ok: code === 0, output: `${status}\n${trimmed}`.trimEnd() });
    });
  });
}
