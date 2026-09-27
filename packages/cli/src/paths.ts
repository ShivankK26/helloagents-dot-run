import path from "node:path";
import type { Io } from "./io.js";

export type Scope = "project" | "global";

/** The `.claude` directory entries are installed into. */
export function claudeDir(io: Io, scope: Scope): string {
  return path.join(scope === "global" ? io.home : io.cwd, ".claude");
}

/** Local path for a registry file path like `agents/foo.md`. */
export function localPath(root: string, registryPath: string): string {
  return path.join(root, ...registryPath.split("/"));
}

/** A short, friendly version of `p` for output: relative to cwd, or ~-prefixed. */
export function display(io: Io, p: string): string {
  const rel = path.relative(io.cwd, p);
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  const fromHome = path.relative(io.home, p);
  if (!fromHome.startsWith("..") && !path.isAbsolute(fromHome)) return path.join("~", fromHome);
  return p;
}
