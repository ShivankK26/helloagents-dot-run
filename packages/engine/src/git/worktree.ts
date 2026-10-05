import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
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

/** What a new .gitignore keeps out: secrets first, then installs and build output. */
export const DEFAULT_GITIGNORE = `# Added by helloagents. Secrets and build files stay out of git.
.env
.env.*
!.env.example
*secret*
*Secret*
*.pem
*.key
*.p12
*.mobileprovision
GoogleService-Info.plist

.DS_Store
node_modules/
dist/
build/
.next/
out/
coverage/
.venv/
__pycache__/
target/
DerivedData/
xcuserdata/
*.xcuserstate
`;

/**
 * Makes a plain folder usable by helloagents: \`git init\` if needed, a
 * .gitignore if there isn't one, and a first commit of the current files.
 * Nothing leaves the Mac. Returns the first commit.
 */
export async function setUpRepo(dir: string): Promise<string> {
  if (!(await isGitRepo(dir))) await git(dir, ["init", "--quiet", "--initial-branch", "main"]);
  const ignore = path.join(dir, ".gitignore");
  if (!(await stat(ignore).catch(() => null))) await writeFile(ignore, DEFAULT_GITIGNORE);
  if (
    await git(dir, ["rev-parse", "HEAD"]).then(
      () => true,
      () => false,
    )
  )
    return headCommit(dir);
  // Use the user's git name and email; without them, commit as helloagents.
  const named = await git(dir, ["config", "user.email"]).then(
    (v) => Boolean(v.trim()),
    () => false,
  );
  const who = named
    ? []
    : ["-c", "user.name=helloagents", "-c", "user.email=helloagents@localhost"];
  await git(dir, ["add", "--all"]);
  await git(dir, [
    ...who,
    "commit",
    "--quiet",
    "--allow-empty",
    "-m",
    "First commit (set up by helloagents)",
  ]);
  return headCommit(dir);
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
export async function createWorktree(
  repo: string,
  root: string,
  name: string,
  baseRef = "HEAD",
): Promise<Worktree> {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "run";
  const base = (await git(repo, ["rev-parse", "--verify", `${baseRef}^{commit}`])).trim();
  const branch = `helloagents/${slug}`;
  const dir = path.join(root, `${path.basename(repo)}-${slug}`);
  await mkdir(root, { recursive: true });
  await git(repo, ["worktree", "add", "-b", branch, dir, base]);
  await excludeLocally(repo, ".helloagents/");
  return { path: dir, branch, base };
}

/** Keeps a path out of git for this clone only (.git/info/exclude), e.g. agent screenshots. */
async function excludeLocally(repo: string, pattern: string): Promise<void> {
  const common = (await git(repo, ["rev-parse", "--git-common-dir"])).trim();
  const file = path.resolve(repo, common, "info", "exclude");
  const current = await readFile(file, "utf8").catch(() => "");
  if (current.split("\n").includes(pattern)) return;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${current}${current && !current.endsWith("\n") ? "\n" : ""}${pattern}\n`);
}

/** The repo's "origin" URL, or null if it has none. */
export async function originUrl(dir: string): Promise<string | null> {
  return git(dir, ["remote", "get-url", "origin"]).then(
    (u) => u.trim() || null,
    () => null,
  );
}

/**
 * Connects a repo to GitHub as "origin": uses the GitHub repo if it exists,
 * otherwise creates it (private) with the GitHub CLI. If the GitHub repo is
 * empty, pushes the base branch first so pull requests have something to target.
 */
export async function connectGitHub(
  repo: string,
  target: string,
  baseBranch: string,
): Promise<{ url: string; created: boolean }> {
  const name = parseGitHubRepo(target);
  if (!name) throw new Error(`"${target}" isn't a GitHub repo. Use owner/name or its URL.`);
  const gh = (args: string[]) =>
    new Promise<string>((resolve, reject) =>
      execFile("gh", args, { cwd: repo }, (error, stdout, stderr) =>
        error
          ? reject(
              new Error(
                (error as NodeJS.ErrnoException).code === "ENOENT"
                  ? "The GitHub CLI (gh) isn't installed. Install it with `brew install gh` and run `gh auth login`."
                  : stderr.trim() || error.message,
              ),
            )
          : resolve(stdout),
      ),
    );
  let created = false;
  let empty = true;
  try {
    empty = (
      JSON.parse(await gh(["repo", "view", name, "--json", "isEmpty"])) as { isEmpty: boolean }
    ).isEmpty;
  } catch (e) {
    if ((e as Error).message.includes("gh) isn't installed")) throw e;
    await gh(["repo", "create", name, "--private"]);
    created = true;
  }
  const url = `https://github.com/${name}.git`;
  if (await originUrl(repo)) await git(repo, ["remote", "set-url", "origin", url]);
  else await git(repo, ["remote", "add", "origin", url]);
  if (empty) await git(repo, ["push", "--set-upstream", "origin", baseBranch]);
  return { url: `https://github.com/${name}`, created };
}

/** "owner/name", from "owner/name", a github.com URL or an SSH address. */
export function parseGitHubRepo(text: string): string | null {
  const t = text.trim().replace(/\.git$/, "");
  const m = /github\.com[/:]([\w.-]+)\/([\w.-]+)/.exec(t) ?? /^([\w.-]+)\/([\w.-]+)$/.exec(t);
  return m ? `${m[1]}/${m[2]}` : null;
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

/** The checked-out branch, or null when HEAD is detached. */
export async function currentBranch(repo: string): Promise<string | null> {
  const name = (await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"])).trim();
  return name === "HEAD" ? null : name;
}

/** Local branches, most recently used first, without helloagents' own run branches. */
export async function listBranches(repo: string): Promise<string[]> {
  const out = await git(repo, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)",
    "refs/heads",
  ]);
  return out
    .split("\n")
    .map((b) => b.trim())
    .filter((b) => b && !b.startsWith("helloagents/"));
}

export async function headCommit(repo: string): Promise<string> {
  return (await git(repo, ["rev-parse", "--short", "HEAD"])).trim();
}

export async function hasUncommitted(dir: string): Promise<boolean> {
  return (await git(dir, ["status", "--porcelain"])).trim().length > 0;
}

/** Commits everything in a checkout. Returns the new commit, or null if there was nothing to commit. */
export async function commitAll(dir: string, message: string): Promise<string | null> {
  if (!(await hasUncommitted(dir))) return null;
  await git(dir, ["add", "--all"]);
  await git(dir, ["commit", "--quiet", "-m", message]);
  return headCommit(dir);
}

/** Pushes a branch to origin and sets it as upstream. */
export async function pushBranch(dir: string, branch: string): Promise<void> {
  await git(dir, ["push", "--set-upstream", "origin", branch]);
}

/**
 * Merges a run's branch into the branch it came from, in the user's own
 * checkout. Refuses when that checkout is on another branch or has
 * uncommitted work, rather than touching it.
 */
export async function mergeInto(repo: string, branch: string, into: string): Promise<void> {
  const current = await currentBranch(repo);
  if (current !== into) {
    throw new Error(
      `Your project is on "${current ?? "a detached HEAD"}". Switch it to "${into}" first.`,
    );
  }
  if (await hasUncommitted(repo)) {
    throw new Error(
      `Your project has uncommitted changes on "${into}". Commit or stash them first.`,
    );
  }
  await git(repo, ["merge", "--no-ff", "--no-edit", branch]);
}
