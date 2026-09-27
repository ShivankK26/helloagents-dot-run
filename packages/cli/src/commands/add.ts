import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Io } from "../io.js";
import { CliError, plural, type Style } from "../output.js";
import { claudeDir, display, localPath, type Scope } from "../paths.js";
import { fetchFile, fetchIndex, type RegistryEntry } from "../registry.js";
import { findEntries, typeLabel } from "./shared.js";

export interface AddOptions {
  names: string[];
  scope: Scope;
  force: boolean;
}

type Outcome = "added" | "updated" | "unchanged" | "skipped";

export async function add(io: Io, style: Style, options: AddOptions): Promise<number> {
  if (options.names.length === 0) {
    throw new CliError(
      "Tell me what to add, e.g. helloagents add code-reviewer\nSee everything with: helloagents list",
      2,
    );
  }
  const index = await fetchIndex(io);
  // Resolve every name before touching disk, so a typo doesn't leave a half-done install.
  const entries = findEntries(index, options.names);
  const root = claudeDir(io, options.scope);

  let skipped = 0;
  for (const entry of entries) {
    const outcome = await install(io, style, entry, root, options.force);
    if (outcome === "skipped") skipped++;
  }

  if (entries.length > skipped) {
    io.out("");
    io.out(style.dim("Start a new Claude Code session to use what you added."));
  }
  return skipped > 0 ? 1 : 0;
}

async function install(
  io: Io,
  style: Style,
  entry: RegistryEntry,
  root: string,
  force: boolean,
): Promise<Outcome> {
  const files = await Promise.all(
    entry.files.map(async (file) => {
      const dest = localPath(root, file.path);
      const data = await fetchFile(io, file);
      const existing = await readFile(dest).catch(() => undefined);
      return { dest, data, existing };
    }),
  );

  const target = display(
    io,
    entry.type === "agent"
      ? localPath(root, entry.files[0]?.path ?? "")
      : path.join(root, "skills", entry.name),
  );
  const label = `${typeLabel(entry.type)} ${style.bold(entry.name)}`;
  const changed = files.filter((f) => !f.existing?.equals(f.data));
  if (changed.length === 0) {
    io.out(`${style.green("✔")} ${label} is already up to date ${style.dim(`(${target})`)}`);
    return "unchanged";
  }

  const conflicts = changed.filter((f) => f.existing !== undefined);
  if (conflicts.length > 0 && !force) {
    const list = conflicts.map((f) => `  ${display(io, f.dest)}`).join("\n");
    if (!io.interactive) {
      io.err(
        `${style.yellow("!")} Skipped ${label}: these files already exist and differ:\n${list}\n  Re-run with --force to overwrite them.`,
      );
      return "skipped";
    }
    io.out(
      `${style.yellow("!")} ${label} would overwrite ${plural(conflicts.length, "existing file")}:\n${list}`,
    );
    if (!(await io.confirm("Overwrite?"))) {
      io.out(`  Skipped ${entry.name}.`);
      return "skipped";
    }
  }

  for (const file of changed) await writeAtomic(file.dest, file.data);

  const verb = conflicts.length > 0 ? "Updated" : "Added";
  const count = entry.type === "skill" ? ` ${style.dim(`(${plural(files.length, "file")})`)}` : "";
  io.out(`${style.green("✔")} ${verb} ${label} → ${target}${count}`);
  return conflicts.length > 0 ? "updated" : "added";
}

async function writeAtomic(dest: string, data: Buffer): Promise<void> {
  await mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.${process.pid}.tmp`;
  try {
    await writeFile(tmp, data);
    await rename(tmp, dest);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}
