import { realpath } from "node:fs/promises";
import path from "node:path";

export class OutsideWorkspaceError extends Error {}

/**
 * Resolves a model-supplied path inside the workspace. The path is untrusted:
 * `..`, absolute paths and symlinks that lead outside are all rejected.
 */
export async function resolveInside(root: string, requested: string): Promise<string> {
  const realRoot = await realpath(root);
  const target = path.resolve(realRoot, requested);
  // Resolve symlinks on the deepest part of the path that exists, so a link
  // inside the workspace can't point somewhere else.
  let existing = target;
  const rest: string[] = [];
  for (;;) {
    try {
      existing = await realpath(existing);
      break;
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) break;
      rest.unshift(path.basename(existing));
      existing = parent;
    }
  }
  const resolved = path.join(existing, ...rest);
  const rel = path.relative(realRoot, resolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new OutsideWorkspaceError(`"${requested}" is outside the workspace`);
  }
  return resolved;
}

/** Path relative to the workspace, with forward slashes, for showing to the model. */
export function displayPath(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join("/") || ".";
}
