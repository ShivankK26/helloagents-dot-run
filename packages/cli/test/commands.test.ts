import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { suggest } from "../src/fuzzy.js";
import { isSafePath } from "../src/registry.js";
import { HELP, run } from "../src/run.js";
import { testIo } from "./helpers.js";

describe("list", () => {
  test("groups entries by type", async () => {
    const io = await testIo();
    expect(await run(["list"], io)).toBe(0);
    const out = io.stdout.join("\n");
    expect(out).toMatch(/^Sub-agents \(2\)\n {2}code-reviewer {2}Reviews code changes/);
    expect(out).toContain("Skills (2)\n  changelog");
    expect(out).toContain("helloagents add <name>");
  });

  test("marks installed entries", async () => {
    const io = await testIo();
    await run(["add", "debugger"], io);
    io.stdout.length = 0;
    await run(["list"], io);
    expect(io.stdout).toContain(
      "✓ debugger       Finds the root cause of failing tests and crashes.",
    );
    expect(io.stdout.join("\n")).toContain("✓ installed (1 entry)");
  });

  test("--type filters and --json prints JSON", async () => {
    const io = await testIo();
    expect(await run(["list", "--type", "skills", "--json"], io)).toBe(0);
    const data = JSON.parse(io.stdout.join("\n")) as { name: string }[];
    expect(data.map((e) => e.name)).toEqual(["changelog", "sql-helper"]);
  });

  test("rejects an unknown --type", async () => {
    const io = await testIo();
    expect(await run(["list", "--type", "plugins"], io)).toBe(2);
    expect(io.output()).toContain('--type must be "agents" or "skills"');
  });

  test("truncates long descriptions to the terminal width", async () => {
    const io = await testIo();
    io.columns = 40;
    await run(["list"], io);
    const rows = io.stdout.filter((l) => /^[ ✓] \S/.test(l));
    expect(rows).toHaveLength(4);
    for (const row of rows) expect(row.length).toBeLessThanOrEqual(40);
    expect(rows[0]).toMatch(/…$/);
  });
});

describe("search", () => {
  test("matches names, tags and descriptions, best first", async () => {
    const io = await testIo();
    expect(await run(["search", "sql", "--json"], io)).toBe(0);
    expect((JSON.parse(io.stdout.join("")) as { name: string }[]).map((e) => e.name)).toEqual([
      "sql-helper",
    ]);
  });

  test("requires every word to match", async () => {
    const io = await testIo();
    await run(["search", "git", "history", "--json"], io);
    expect((JSON.parse(io.stdout.join("")) as { name: string }[]).map((e) => e.name)).toEqual([
      "changelog",
    ]);
  });

  test("prints a readable result list", async () => {
    const io = await testIo();
    expect(await run(["search", "review"], io)).toBe(0);
    expect(io.stdout[0]).toBe('1 match for "review"');
    expect(io.stdout.join("\n")).toContain("code-reviewer");
  });

  test("suggests names when nothing matches", async () => {
    const io = await testIo();
    expect(await run(["search", "debuger"], io)).toBe(1);
    expect(io.stdout).toEqual([
      'No entries match "debuger".',
      "Did you mean debugger?",
      "See everything with: helloagents list",
    ]);
  });

  test("needs a query", async () => {
    const io = await testIo();
    expect(await run(["search"], io)).toBe(2);
  });
});

describe("remove", () => {
  async function installed(options: Parameters<typeof testIo>[0] = {}) {
    const io = await testIo(options);
    await run(["add", "debugger", "changelog"], io);
    io.stdout.length = 0;
    return io;
  }

  test("removes a sub-agent file and a skill folder with --yes", async () => {
    const io = await installed();
    expect(await run(["remove", "debugger", "changelog", "--yes"], io)).toBe(0);
    expect(await readdir(path.join(io.cwd, ".claude/agents"))).toEqual([]);
    expect(await readdir(path.join(io.cwd, ".claude/skills"))).toEqual([]);
    expect(io.stdout).toContain("✔ Removed sub-agent debugger (.claude/agents/debugger.md)");
  });

  test("asks for confirmation when interactive", async () => {
    const io = await installed({ interactive: true, answers: [false] });
    expect(await run(["remove", "changelog"], io)).toBe(1);
    expect(io.stdout.join("\n")).toContain("This will delete:\n  .claude/skills/changelog/");
    expect(await readdir(path.join(io.cwd, ".claude/skills"))).toEqual(["changelog"]);
  });

  test("refuses to delete without --yes when not interactive", async () => {
    const io = await installed();
    expect(await run(["rm", "changelog"], io)).toBe(1);
    expect(io.output()).toContain("Re-run with --yes to confirm.");
    expect(await readdir(path.join(io.cwd, ".claude/skills"))).toEqual(["changelog"]);
  });

  test("works without network access", async () => {
    const io = await installed();
    io.fetch = (() => Promise.reject(new Error("offline"))) as typeof fetch;
    expect(await run(["remove", "debugger", "-y"], io)).toBe(0);
  });

  test("explains when something isn't installed, with suggestions", async () => {
    const io = await installed();
    expect(await run(["remove", "debuger", "-y"], io)).toBe(1);
    expect(io.stderr.join("\n")).toBe(
      '✖ "debuger" isn\'t installed in .claude. Did you mean debugger?\nFor entries installed with --global, add --global.',
    );
  });

  test("--global removes from ~/.claude", async () => {
    const io = await testIo();
    const file = path.join(io.home, ".claude/agents/mine.md");
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "x");
    expect(await run(["remove", "mine", "--global", "--yes"], io)).toBe(0);
    expect(await readdir(path.dirname(file))).toEqual([]);
  });

  test.each(["../secrets", "a/b", "."])("rejects the unsafe name %s", async (name) => {
    const io = await testIo();
    expect(await run(["remove", name, "--yes"], io)).toBe(2);
    expect(io.output()).toContain("isn't a valid entry name");
  });
});

describe("general", () => {
  test("prints help with no arguments, help, or --help", async () => {
    for (const args of [[], ["help"], ["--help"], ["add", "-h"]]) {
      const io = await testIo();
      expect(await run(args, io)).toBe(0);
      expect(io.stdout.join("\n")).toBe(HELP);
    }
  });

  test("prints the version", async () => {
    const io = await testIo();
    expect(await run(["--version"], io)).toBe(0);
    expect(io.stdout[0]).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("rejects unknown commands and options", async () => {
    const io = await testIo();
    expect(await run(["instal", "x"], io)).toBe(2);
    expect(io.output()).toContain('Unknown command "instal"');
    const io2 = await testIo();
    expect(await run(["add", "x", "--frce"], io2)).toBe(2);
    expect(io2.output()).toContain("--frce");
  });

  test("supports install/ls aliases", async () => {
    const io = await testIo();
    expect(await run(["install", "debugger"], io)).toBe(0);
    expect(await run(["ls"], io)).toBe(0);
  });
});

describe("isSafePath", () => {
  test.each([
    ["agent", "foo", "agents/foo.md", true],
    ["agent", "foo", "agents/bar.md", false],
    ["agent", "foo", "agents/foo.md/../../x", false],
    ["skill", "foo", "skills/foo/SKILL.md", true],
    ["skill", "foo", "skills/foo/scripts/run.sh", true],
    ["skill", "foo", "skills/foo/../bar/SKILL.md", false],
    ["skill", "foo", "skills/foo/.env", false],
    ["skill", "foo", "skills/foo//x", false],
    ["skill", "foo", "skills/foobar/SKILL.md", false],
  ] as const)("%s %s %s → %s", (type, name, p, expected) => {
    expect(isSafePath(type, name, p)).toBe(expected);
  });
});

describe("suggest", () => {
  const names = ["code-reviewer", "debugger", "changelog", "commit-messages", "sql-helper"];
  test.each([
    ["code-reveiwer", ["code-reviewer"]],
    ["reviewer", ["code-reviewer"]],
    ["sql", ["sql-helper"]],
    ["kubernetes", []],
  ])("%s → %o", (input, expected) => {
    expect(suggest(input, names)).toEqual(expected);
  });
});
