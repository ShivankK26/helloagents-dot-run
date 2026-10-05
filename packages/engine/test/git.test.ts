import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createWorktree,
  detectAgents,
  findChildRepos,
  git,
  isGitRepo,
  parseGitHubRepo,
  removeWorktree,
  setUpRepo,
  worktreeDiff,
  type RunCommand,
} from "../src/index";
import { tempDir, workspace } from "./helpers";

async function repo(
  files: Record<string, string> = { "math.js": "export const add = (a, b) => a - b;\n" },
) {
  const dir = await workspace(files);
  await git(dir, ["init", "-q", "-b", "main"]);
  await git(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"]);
  await git(dir, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  return dir;
}

describe("worktrees", () => {
  test("detects git repos", async () => {
    expect(await isGitRepo(await repo())).toBe(true);
    expect(await isGitRepo(await tempDir())).toBe(false);
  });

  test("finds the repos inside a folder of projects", async () => {
    const parent = await tempDir();
    for (const name of ["api", "web"]) {
      const r = await repo();
      await git(r, ["clone", "-q", r, path.join(parent, name)]);
    }
    await mkdir(path.join(parent, "notes"));
    expect((await findChildRepos(parent)).map((p) => path.basename(p))).toEqual(["api", "web"]);
  });

  test("gives an agent its own branch and folder, leaving the user's copy alone", async () => {
    const r = await repo();
    const root = await tempDir();
    const wt = await createWorktree(r, root, "Fix add() bug!");
    expect(wt.branch).toBe("helloagents/fix-add-bug");
    expect(wt.path).toBe(path.join(root, `${path.basename(r)}-fix-add-bug`));
    await writeFile(path.join(wt.path, "math.js"), "export const add = (a, b) => a + b;\n");
    await writeFile(path.join(wt.path, "new.js"), "export {};\n");
    expect(await readFile(path.join(r, "math.js"), "utf8")).toContain("a - b");

    const diff = await worktreeDiff(wt);
    expect(diff).toContain("-export const add = (a, b) => a - b;");
    expect(diff).toContain("+export const add = (a, b) => a + b;");
    expect(diff).toContain("+++ b/new.js");

    await removeWorktree(r, wt, { deleteBranch: true });
    expect(await git(r, ["branch", "--list", "helloagents/*"])).toBe("");
  });
});

describe("detectAgents", () => {
  test("reports installed CLIs with versions and missing ones with an install hint", async () => {
    const run: RunCommand = async (command) => {
      if (command === "claude") return { stdout: "2.1.288 (Claude Code)\n" };
      throw Object.assign(new Error("not found"), { code: "ENOENT" });
    };
    const agents = await detectAgents(run);
    expect(agents.map((a) => [a.id, a.installed, a.version])).toEqual([
      ["claude-code", true, "2.1.288"],
      ["codex", false, undefined],
    ]);
    expect(agents[1]!.installHint).toMatch(/npm install -g @openai\/codex/);
  });
});

describe("setUpRepo", () => {
  test("turns a plain folder into a repo with a first commit, keeping secrets out", async () => {
    const dir = await workspace({
      "App/main.swift": "print(1)\n",
      "Secrets.xcconfig": "API_KEY = x\n",
      ".env": "TOKEN=x\n",
      "node_modules/x/index.js": "",
    });
    const sha = await setUpRepo(dir);
    expect(sha).toMatch(/^[0-9a-f]{7,}$/);
    const tracked = (await git(dir, ["ls-files"])).trim().split("\n").sort();
    expect(tracked).toEqual([".gitignore", "App/main.swift"]);
    // Running it again on a set-up repo changes nothing.
    expect(await setUpRepo(dir)).toBe(sha);
  });
});

describe("GitHub", () => {
  test("reads owner/name from what people paste", () => {
    expect(parseGitHubRepo("ShivankK26/clearstock-ios-app")).toBe("ShivankK26/clearstock-ios-app");
    expect(parseGitHubRepo("https://github.com/acme/web.git")).toBe("acme/web");
    expect(parseGitHubRepo("git@github.com:acme/web.git")).toBe("acme/web");
    expect(parseGitHubRepo("not a repo")).toBeNull();
  });

  test("agent screenshots in .helloagents/ stay out of git", async () => {
    const dir = await workspace({ "a.txt": "a" });
    await setUpRepo(dir);
    const wt = await createWorktree(dir, await tempDir(), "shots");
    await mkdir(path.join(wt.path, ".helloagents/screenshots"), { recursive: true });
    await writeFile(path.join(wt.path, ".helloagents/screenshots/home.png"), "png");
    expect((await git(wt.path, ["status", "--porcelain"])).trim()).toBe("");
  });
});
