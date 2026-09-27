import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { suggest } from "../fuzzy.js";
import type { Io } from "../io.js";
import { CliError, plural, type Style } from "../output.js";
import { claudeDir, display, type Scope } from "../paths.js";
import { formatList } from "./shared.js";

export interface RemoveOptions {
  names: string[];
  scope: Scope;
  yes: boolean;
}

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Installed {
  name: string;
  kind: "sub-agent" | "skill";
  path: string;
  isDir: boolean;
}

/** Removes installed entries. Works offline: it only looks at .claude/. */
export async function remove(io: Io, style: Style, options: RemoveOptions): Promise<number> {
  if (options.names.length === 0) {
    throw new CliError("Tell me what to remove, e.g. helloagents remove code-reviewer", 2);
  }
  const root = claudeDir(io, options.scope);
  const where = options.scope === "global" ? "~/.claude" : ".claude";

  const targets: Installed[] = [];
  const missing: string[] = [];
  for (const raw of new Set(options.names)) {
    const name = raw.trim().toLowerCase();
    // The name becomes a path, so never accept anything but a plain slug.
    if (!NAME.test(name)) throw new CliError(`"${raw}" isn't a valid entry name.`, 2);
    const found = await findInstalled(root, name);
    if (found.length === 0) missing.push(name);
    targets.push(...found);
  }

  if (missing.length > 0) {
    const installed = await listInstalled(root);
    const lines = missing.map((name) => {
      const close = suggest(name, installed);
      return `"${name}" isn't installed in ${where}.${close.length > 0 ? ` Did you mean ${formatList(close)}?` : ""}`;
    });
    if (options.scope === "project")
      lines.push("For entries installed with --global, add --global.");
    throw new CliError(lines.join("\n"));
  }

  const summary = targets.map((t) => `  ${display(io, t.path)}${t.isDir ? "/" : ""}`).join("\n");
  if (!options.yes) {
    if (!io.interactive) {
      throw new CliError(`This will delete:\n${summary}\nRe-run with --yes to confirm.`);
    }
    io.out(`This will delete:\n${summary}`);
    if (!(await io.confirm("Continue?"))) {
      io.out("Nothing removed.");
      return 1;
    }
  }

  for (const target of targets) {
    await rm(target.path, { recursive: target.isDir, force: true });
    io.out(
      `${style.green("✔")} Removed ${target.kind} ${style.bold(target.name)} ${style.dim(`(${display(io, target.path)})`)}`,
    );
  }
  if (targets.length > 1) io.out(style.dim(`Removed ${plural(targets.length, "item")}.`));
  return 0;
}

async function findInstalled(root: string, name: string): Promise<Installed[]> {
  const found: Installed[] = [];
  const agent = path.join(root, "agents", `${name}.md`);
  const skill = path.join(root, "skills", name);
  if ((await stat(agent).catch(() => undefined))?.isFile()) {
    found.push({ name, kind: "sub-agent", path: agent, isDir: false });
  }
  if ((await stat(skill).catch(() => undefined))?.isDirectory()) {
    found.push({ name, kind: "skill", path: skill, isDir: true });
  }
  return found;
}

async function listInstalled(root: string): Promise<string[]> {
  const agents = await readdir(path.join(root, "agents")).catch(() => [] as string[]);
  const skills = await readdir(path.join(root, "skills")).catch(() => [] as string[]);
  return [...agents.filter((f) => f.endsWith(".md")).map((f) => f.slice(0, -3)), ...skills];
}
