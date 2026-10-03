import { execFile } from "node:child_process";
import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";

/** Runs git and returns stdout. Throws with git's own message on failure. */
export function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, maxBuffer: 20 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) reject(new Error(stderr.trim() || error.message));
      else resolve(stdout);
    });
  });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    return (await git(dir, ["rev-parse", "--is-inside-work-tree"])).trim() === "true";
  } catch {
    return false;
  }
}

/** Git repos directly inside a folder, for importing a folder of several projects. */
export async function findChildRepos(dir: string): Promise<string[]> {
  const found: string[] = [];
  for (const name of (await readdir(dir)).sort()) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const full = path.join(dir, name);
    try {
      if (
        (await stat(full)).isDirectory() &&
        (await stat(path.join(full, ".git")).catch(() => null))
      )
        found.push(full);
    } catch {
      // unreadable entries are skipped
    }
  }
  return found;
}

export interface Worktree {
  path: string;
  branch: string;
  /** Commit the branch started from. */
  base: string;
}

/**
 * Creates an isolated checkout for one agent: a new branch off the current
 * HEAD, in its own folder outside the repo. The user's working copy is untouched.
 */
export async function createWorktree(repo: string, root: string, name: string): Promise<Worktree> {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "run";
  const base = (await git(repo, ["rev-parse", "HEAD"])).trim();
  const branch = `helloagents/${slug}`;
  const dir = path.join(root, `${path.basename(repo)}-${slug}`);
  await mkdir(root, { recursive: true });
  await git(repo, ["worktree", "add", "-b", branch, dir, base]);
  return { path: dir, branch, base };
}

export async function removeWorktree(
  repo: string,
  worktree: Worktree,
  { deleteBranch = false } = {},
): Promise<void> {
  await git(repo, ["worktree", "remove", "--force", worktree.path]);
  if (deleteBranch) await git(repo, ["branch", "-D", worktree.branch]);
}

/** Everything the agent changed in its worktree, committed or not, against where it started. */
export async function worktreeDiff(worktree: Worktree): Promise<string> {
  // Include new files that were never staged.
  await git(worktree.path, ["add", "--intent-to-add", "--all"]);
  return git(worktree.path, ["diff", worktree.base]);
}

export async function cloneRepo(url: string, dest: string): Promise<string> {
  await mkdir(path.dirname(dest), { recursive: true });
  await git(path.dirname(dest), ["clone", "--", url, dest]);
  return dest;
}
