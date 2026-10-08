import { spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

/** A slash command, skill or MCP connector the user can use in a project. */
export interface SlashCommand {
  /** Without the leading slash, e.g. "security-review" or "supabase:supabase". */
  name: string;
  description: string;
  kind: "skill" | "command" | "mcp";
}

const MCP_STATUS: Record<string, string> = {
  connected: "MCP connector",
  "needs-auth": "MCP connector · needs sign-in in Claude Code",
  failed: "MCP connector · failed to connect",
  pending: "MCP connector · connecting",
};

/**
 * Commands that change Claude Code's own interactive session (model, context,
 * settings…). They mean nothing in a one-off headless run, so they're not offered;
 * helloagents has its own controls for the useful ones (model, effort).
 */
const SESSION_ONLY = new Set(
  (
    "model effort clear compact config context fast rename color focus heapdump mcp import " +
    "reload-plugins reload-skills usage usage-credits extra-usage auto-mode-setup autocompact " +
    "output-style agents list-agents design-consent design-revoke doctor team-onboarding " +
    "workflow-launch-exec loop schedule advisor goal insights statusline terminal-setup recap"
  ).split(" "),
);

/** Short descriptions for Claude Code's built-ins, which don't ship a description file. */
const BUILT_IN: Record<string, string> = {
  init: "Write a CLAUDE.md that explains this project to Claude",
  "security-review": "Review the changes for security issues",
  "code-review": "Review the code changes",
  review: "Review a pull request",
  debug: "Track down a bug",
  simplify: "Simplify recently changed code",
  verify: "Check that a change actually works",
  batch: "Split a large change into parallel pieces",
  "claude-api": "Build with the Claude API",
  dataviz: "Make charts and data visuals",
  "fewer-permission-prompts": "Allow common safe commands to skip prompts",
};

/** Shown first: the commands most useful for coding work. */
const CORE = ["init", "security-review", "code-review", "review", "debug", "simplify", "verify"];

interface InitInfo {
  slash_commands?: string[];
  terminal_slash_commands?: string[];
  skills?: string[];
  plugins?: Array<{ name: string; path: string }>;
  mcp_servers?: Array<{ name: string; status: string }>;
}

/**
 * Asks Claude Code which commands and skills it has in a folder. It announces
 * them in its first output line, before calling the model, so the process is
 * stopped right there: no tokens are used.
 */
export function readClaudeInit(
  cwd: string,
  claudePath = "claude",
  timeoutMs = 20_000,
): Promise<InitInfo> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      claudePath,
      ["-p", "list", "--output-format", "stream-json", "--verbose", "--max-turns", "1"],
      {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let buffer = "";
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill("SIGKILL");
      fn();
    };
    const timer = setTimeout(
      () => finish(() => reject(new Error("Claude Code didn't start in time."))),
      timeoutMs,
    );
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        try {
          const msg = JSON.parse(line) as InitInfo & { type?: string; subtype?: string };
          if (msg.type === "system" && msg.subtype === "init") return finish(() => resolve(msg));
        } catch {
          // not JSON; keep reading
        }
      }
    });
    child.on("error", (e) => finish(() => reject(e)));
    child.on("close", () =>
      finish(() => reject(new Error("Claude Code exited before listing its commands."))),
    );
  });
}

/** Reads `description:` from a Markdown file's front matter. */
async function describe(file: string): Promise<string | undefined> {
  try {
    const text = await readFile(file, "utf8");
    const lines = (/^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "").split("\n");
    const at = lines.findIndex((l) => l.startsWith("description:"));
    if (at < 0) return undefined;
    let d = (lines[at] ?? "").slice("description:".length).trim();
    // YAML block (">" or "|"): the indented lines that follow.
    if (/^[>|][-+]?$/.test(d)) {
      const block: string[] = [];
      for (const l of lines.slice(at + 1)) {
        if (l && !/^\s/.test(l)) break;
        block.push(l.trim());
      }
      d = block.join(" ");
    }
    d = d
      .replace(/^(["'])(.*)\1$/, "$2")
      .replace(/\s+/g, " ")
      .trim();
    return d || undefined;
  } catch {
    return undefined;
  }
}

/** name → description, from skill and command files in the usual places. */
async function descriptions(
  project: string,
  plugins: InitInfo["plugins"],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const scan = async (root: string, prefix = "") => {
    for (const kind of ["skills", "commands"] as const) {
      const dir = path.join(root, kind);
      let entries: string[];
      try {
        entries = await readdir(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const name = kind === "skills" ? entry : entry.replace(/\.md$/, "");
        const file = kind === "skills" ? path.join(dir, entry, "SKILL.md") : path.join(dir, entry);
        if (kind === "commands" && !entry.endsWith(".md")) continue;
        const d = await describe(file);
        if (d) found.set(prefix + name, d);
      }
    }
  };
  await scan(path.join(homedir(), ".claude"));
  await scan(path.join(project, ".claude"));
  for (const p of plugins ?? []) if (path.isAbsolute(p.path)) await scan(p.path, `${p.name}:`);
  return found;
}

/** The commands and skills worth offering in a project, with descriptions. */
export async function listSlashCommands(
  project: string,
  claudePath?: string,
): Promise<SlashCommand[]> {
  const init = await readClaudeInit(project, claudePath);
  const terminalOnly = new Set(init.terminal_slash_commands ?? []);
  const skills = new Set(init.skills ?? []);
  const notes = await descriptions(project, init.plugins);
  const seen = new Set<string>();
  const out: SlashCommand[] = [];
  for (const name of init.slash_commands ?? []) {
    if (seen.has(name) || name.startsWith("__") || SESSION_ONLY.has(name) || terminalOnly.has(name))
      continue;
    seen.add(name);
    out.push({
      name,
      kind: skills.has(name) ? "skill" : "command",
      description: notes.get(name) ?? BUILT_IN[name] ?? "",
    });
  }
  // Built-ins first, then the rest alphabetically, then the MCP connectors.
  const core = (c: SlashCommand) => Number(CORE.includes(c.name));
  out.sort((a, b) => core(b) - core(a) || a.name.localeCompare(b.name));
  for (const server of init.mcp_servers ?? []) {
    const name = server.name.replace(/^plugin:[^:]+:/, "");
    if (seen.has(`mcp:${name}`)) continue;
    seen.add(`mcp:${name}`);
    out.push({
      name,
      kind: "mcp",
      description: MCP_STATUS[server.status] ?? `MCP connector · ${server.status}`,
    });
  }
  return out;
}

/** True when a task is a slash command, like "/security-review the upload code". */
export const isSlashTask = (task: string) => /^\/[\w:-]+/.test(task.trimStart());
