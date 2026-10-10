import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import type * as NodePty from "node-pty";
import type { IPty } from "node-pty";

/**
 * The terminal drawer's shells: a real login shell per drawer session, through
 * node-pty, so it behaves like Terminal.app (colours, prompts, ⌃C, vim…).
 */
const shells = new Map<string, IPty>();

type Pty = typeof NodePty;
let pty: Pty | undefined;
function loadPty(): Pty {
  if (pty) return pty;
  pty = createRequire(__filename)("node-pty") as Pty;
  // node-pty's prebuilt helper ships without its executable bit; spawning fails without it.
  for (const arch of ["arm64", "x64"]) {
    const helper = path
      .join(
        path.dirname(createRequire(__filename).resolve("node-pty/package.json")),
        "prebuilds",
        `darwin-${arch}`,
        "spawn-helper",
      )
      .replace("app.asar", "app.asar.unpacked");
    try {
      if (existsSync(helper) && !(statSync(helper).mode & 0o111)) chmodSync(helper, 0o755);
    } catch {
      // read-only install: the build already set it
    }
  }
  return pty;
}

export function startShell(
  cwds: string[],
  cols: number,
  rows: number,
  onData: (id: string, data: string) => void,
  onExit: (id: string, code: number) => void,
): string {
  // A run's folder is removed after shipping; then the project's folder, then home.
  const dir = cwds.find((d) => path.isAbsolute(d) && existsSync(d)) ?? homedir();
  const shell = process.env.SHELL || "/bin/zsh";
  const term = loadPty().spawn(shell, ["-l"], {
    name: "xterm-256color",
    cwd: dir,
    cols: Math.max(2, cols),
    rows: Math.max(1, rows),
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      TERM_PROGRAM: "helloagents",
    } as Record<string, string>,
  });
  const id = randomUUID();
  shells.set(id, term);
  term.onData((data) => onData(id, data));
  term.onExit(({ exitCode }) => {
    shells.delete(id);
    onExit(id, exitCode);
  });
  return id;
}

export const writeShell = (id: string, data: string) => shells.get(id)?.write(data);

export function resizeShell(id: string, cols: number, rows: number): void {
  try {
    shells.get(id)?.resize(Math.max(2, cols), Math.max(1, rows));
  } catch {
    // it just exited
  }
}

export function killShell(id: string): void {
  shells.get(id)?.kill();
  shells.delete(id);
}

export function killAllShells(): void {
  for (const id of [...shells.keys()]) killShell(id);
}
