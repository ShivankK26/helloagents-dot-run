import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { buildRegistry, loadRegistry, RegistryValidationError } from "../src/index.js";
import { agent, makeRegistry, skill, tempDir } from "./helpers.js";

async function issuesFor(files: Parameters<typeof makeRegistry>[0]) {
  const { issues } = await loadRegistry(await makeRegistry(files));
  return issues.map((i) => `${i.file}: ${i.message}`);
}

describe("loadRegistry", () => {
  test("loads agents and skills with their files", async () => {
    const root = await makeRegistry({
      "agents/code-reviewer.md": agent(
        "code-reviewer",
        "tools: Read, Grep\ncategory: code-quality\ntags: [review]\nauthor: octocat\n",
      ),
      "skills/changelog/SKILL.md": skill("changelog"),
      "skills/changelog/references/format.md": "# Format\n",
      "skills/changelog/.DS_Store": "junk",
    });
    const { entries, issues } = await loadRegistry(root);
    expect(issues).toEqual([]);
    expect(entries.map((e) => [e.type, e.name])).toEqual([
      ["agent", "code-reviewer"],
      ["skill", "changelog"],
    ]);
    const [reviewer, changelog] = entries;
    expect(reviewer).toMatchObject({
      tools: ["Read", "Grep"],
      category: "code-quality",
      tags: ["review"],
      author: "octocat",
      mainPath: "agents/code-reviewer.md",
    });
    expect(changelog?.files.map((f) => f.path)).toEqual([
      "skills/changelog/SKILL.md",
      "skills/changelog/references/format.md",
    ]);
  });

  test("an empty or missing registry has no entries", async () => {
    expect(await loadRegistry(await makeRegistry({}))).toEqual({ entries: [], issues: [] });
    const { issues } = await loadRegistry(path.join(await tempDir(), "nope"));
    expect(issues[0]?.message).toMatch(/registry folder not found/);
  });

  test("name must match the file or folder name", async () => {
    expect(
      await issuesFor({
        "agents/reviewer.md": agent("code-reviewer"),
        "skills/changelog/SKILL.md": skill("change-log"),
      }),
    ).toEqual([
      'registry/agents/reviewer.md: name "code-reviewer" must match the file name "reviewer.md"',
      'registry/skills/changelog/SKILL.md: name "change-log" must match the folder name "changelog"',
    ]);
  });

  test("names must be unique across agents and skills", async () => {
    expect(
      await issuesFor({
        "agents/changelog.md": agent("changelog"),
        "skills/changelog/SKILL.md": skill("changelog"),
      }),
    ).toEqual([
      'registry/skills/changelog/SKILL.md: name "changelog" is already used by registry/agents/changelog.md; names must be unique across agents and skills',
    ]);
  });

  test("reports a missing description as a required field", async () => {
    expect(await issuesFor({ "agents/foo.md": "---\nname: foo\n---\nPrompt\n" })).toEqual([
      'registry/agents/foo.md: frontmatter field "description" is required',
    ]);
  });

  test("flags unknown fields with a suggestion, since Claude Code would silently ignore them", async () => {
    expect(await issuesFor({ "agents/foo.md": agent("foo", "tool: Read\ncolour: red\n") })).toEqual(
      [
        'registry/agents/foo.md: unknown frontmatter field "tool" (did you mean "tools"?)',
        'registry/agents/foo.md: unknown frontmatter field "colour" (did you mean "color"?)',
      ],
    );
  });

  test("reports bad YAML and missing frontmatter", async () => {
    expect(
      await issuesFor({
        "agents/a.md": "---\nname: a\ndescription: [oops\n---\nx",
        "agents/b.md": "You are an agent.",
      }),
    ).toEqual([
      expect.stringMatching(/^registry\/agents\/a\.md: invalid YAML on line 3: /),
      "registry/agents/b.md: must start with a `---` line followed by YAML frontmatter",
    ]);
  });

  test("requires a non-empty body", async () => {
    expect(
      await issuesFor({
        "agents/foo.md": agent("foo", "", "  "),
        "skills/bar/SKILL.md": skill("bar", "", ""),
      }),
    ).toEqual([
      "registry/agents/foo.md: the system prompt (text after the frontmatter) is empty",
      "registry/skills/bar/SKILL.md: the instructions (text after the frontmatter) are empty",
    ]);
  });

  test("checks registry layout", async () => {
    expect(
      await issuesFor({
        "agents/notes.txt": "hi",
        "agents/nested/foo.md": agent("foo"),
        "skills/loose.md": skill("loose"),
        "skills/empty/README.md": "# hi",
        "skills/cased/skill.md": skill("cased"),
      }),
    ).toEqual([
      "registry/agents/nested: registry/agents/ may only contain <name>.md files",
      "registry/agents/notes.txt: registry/agents/ may only contain <name>.md files",
      "registry/skills/cased: rename skill.md to SKILL.md (the name is case-sensitive)",
      "registry/skills/empty: skill folder is missing SKILL.md",
      "registry/skills/loose.md: registry/skills/ may only contain folders, one per skill: skills/<name>/SKILL.md",
    ]);
  });

  test("rejects hidden files, odd file names, symlinks and oversized files in skills", async () => {
    expect(
      await issuesFor({
        "skills/foo/SKILL.md": skill("foo"),
        "skills/foo/.env": "SECRET=1",
        "skills/foo/my notes.md": "x",
        "skills/foo/link.md": { symlink: "/etc/hosts" },
        "skills/foo/big.txt": Buffer.alloc(257 * 1024, "a"),
      }),
    ).toEqual([
      "registry/skills/foo/.env: hidden files are not allowed in a skill",
      "registry/skills/foo/link.md: symlinks are not allowed; copy the file in instead",
      "registry/skills/foo/my notes.md: file names may only use letters, digits, '.', '_' and '-'",
      "registry/skills/foo/big.txt: file is 257 KiB; the limit is 256 KiB",
    ]);
  });

  test("collects every problem instead of stopping at the first", async () => {
    const issues = await issuesFor({
      "agents/a.md": agent("A"),
      "agents/b.md": "---\nname: b\ndescription: x\nmodel: gpt\n---\nx",
      "skills/c/SKILL.md": skill("c", "category: nope\n"),
    });
    expect(issues).toHaveLength(3);
    expect(issues.join("\n")).toMatch(/a\.md: frontmatter field "name" must be lowercase/);
    expect(issues.join("\n")).toMatch(/b\.md: frontmatter field "model" must be sonnet/);
    expect(issues.join("\n")).toMatch(/SKILL\.md: frontmatter field "category"/);
  });
});

describe("buildRegistry", () => {
  test("writes registry.json and raw files mirroring the registry layout", async () => {
    const agentSource = agent("code-reviewer", "category: code-quality\nmodel: sonnet\n");
    const registryDir = await makeRegistry({
      "agents/code-reviewer.md": agentSource,
      "skills/changelog/SKILL.md": skill("changelog", "tags: [git, release]\n"),
      "skills/changelog/scripts/run.sh": "#!/bin/sh\necho hi\n",
    });
    const outDir = path.join(await tempDir(), "out");
    const index = await buildRegistry({ registryDir, outDir });

    const written = JSON.parse(await readFile(path.join(outDir, "registry.json"), "utf8"));
    expect(written).toEqual(index);
    expect(index).toEqual({
      version: 1,
      entries: [
        {
          name: "code-reviewer",
          type: "agent",
          description: "Does code-reviewer things.",
          category: "code-quality",
          tags: [],
          model: "sonnet",
          files: [
            {
              path: "agents/code-reviewer.md",
              size: Buffer.byteLength(agentSource),
              sha256: createHash("sha256").update(agentSource).digest("hex"),
            },
          ],
        },
        {
          name: "changelog",
          type: "skill",
          description: "Helps with changelog.",
          tags: ["git", "release"],
          files: [
            expect.objectContaining({ path: "skills/changelog/SKILL.md" }),
            expect.objectContaining({ path: "skills/changelog/scripts/run.sh" }),
          ],
        },
      ],
    });
    expect(await readFile(path.join(outDir, "agents/code-reviewer.md"), "utf8")).toBe(agentSource);
    expect(await readFile(path.join(outDir, "skills/changelog/scripts/run.sh"), "utf8")).toContain(
      "echo hi",
    );
  });

  test("replaces its own previous output but leaves other files alone", async () => {
    const outDir = await tempDir();
    await mkdir(path.join(outDir, "agents"), { recursive: true });
    await writeFile(path.join(outDir, "agents/stale.md"), "old");
    await writeFile(path.join(outDir, "keep.txt"), "mine");
    await buildRegistry({
      registryDir: await makeRegistry({ "agents/fresh.md": agent("fresh") }),
      outDir,
    });
    expect((await readdir(outDir)).sort()).toEqual(["agents", "keep.txt", "registry.json"]);
    expect(await readdir(path.join(outDir, "agents"))).toEqual(["fresh.md"]);
  });

  test("throws a readable error and writes nothing when validation fails", async () => {
    const outDir = path.join(await tempDir(), "out");
    const registryDir = await makeRegistry({
      "agents/a.md": agent("b"),
      "agents/c.md": "---\nname: c\n---\nx",
    });
    const error = await buildRegistry({ registryDir, outDir }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RegistryValidationError);
    expect((error as Error).message).toBe(
      [
        "Registry validation failed with 2 problems:",
        "",
        "  registry/agents/a.md",
        '    ✖ name "b" must match the file name "a.md"',
        "",
        "  registry/agents/c.md",
        '    ✖ frontmatter field "description" is required',
        "",
      ].join("\n"),
    );
    await expect(readdir(outDir)).rejects.toThrow();
  });
});
