import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { run } from "../src/run.js";
import { BASE, agentFile, buildFakeRegistry, fakeFetch, tempDir, testIo } from "./helpers.js";

const read = (p: string) => readFile(p, "utf8");

describe("add", () => {
  test("installs a sub-agent into .claude/agents", async () => {
    const io = await testIo();
    expect(await run(["add", "code-reviewer"], io)).toBe(0);
    expect(await read(path.join(io.cwd, ".claude/agents/code-reviewer.md"))).toBe(
      agentFile("code-reviewer"),
    );
    expect(io.output()).toContain(
      "✔ Added sub-agent code-reviewer → .claude/agents/code-reviewer.md",
    );
    expect(io.output()).toContain("Start a new Claude Code session");
  });

  test("installs every file of a skill, keeping its folder structure", async () => {
    const io = await testIo();
    expect(await run(["add", "changelog"], io)).toBe(0);
    const dir = path.join(io.cwd, ".claude/skills/changelog");
    expect(await read(path.join(dir, "SKILL.md"))).toContain("name: changelog");
    expect(await read(path.join(dir, "references/format.md"))).toBe("# Format\n");
    expect(io.output()).toContain("✔ Added skill changelog → .claude/skills/changelog (2 files)");
  });

  test("installs several entries at once and ignores duplicates", async () => {
    const io = await testIo();
    expect(await run(["add", "debugger", "sql-helper", "debugger"], io)).toBe(0);
    expect(io.stdout.filter((l) => l.startsWith("✔ Added"))).toHaveLength(2);
    expect(await readdir(path.join(io.cwd, ".claude/skills"))).toEqual(["sql-helper"]);
  });

  test("--global installs into ~/.claude", async () => {
    const io = await testIo();
    expect(await run(["add", "-g", "debugger"], io)).toBe(0);
    expect(await read(path.join(io.home, ".claude/agents/debugger.md"))).toContain("debugger");
    expect(io.output()).toContain(`→ ${path.join("~", ".claude/agents/debugger.md")}`);
  });

  test("an unknown name suggests close matches and installs nothing", async () => {
    const io = await testIo();
    expect(await run(["add", "debugger", "code-reveiwer"], io)).toBe(1);
    expect(io.stderr.join("\n")).toBe(
      '✖ Unknown entry "code-reveiwer". Did you mean code-reviewer?\nSearch the registry with: helloagents search <words>',
    );
    await expect(readdir(path.join(io.cwd, ".claude"))).rejects.toThrow();
  });

  test("an unknown name with nothing close still gives a next step", async () => {
    const io = await testIo();
    expect(await run(["add", "kubernetes"], io)).toBe(1);
    expect(io.output()).toContain('Unknown entry "kubernetes".\nSearch the registry');
  });

  test("with no names, explains usage", async () => {
    const io = await testIo();
    expect(await run(["add"], io)).toBe(2);
    expect(io.output()).toContain("helloagents add code-reviewer");
  });

  describe("existing files", () => {
    async function withExisting(content: string, options: Parameters<typeof testIo>[0] = {}) {
      const io = await testIo(options);
      const dest = path.join(io.cwd, ".claude/agents/code-reviewer.md");
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(dest, content);
      return { io, dest };
    }

    test("an identical file is left alone without asking", async () => {
      const { io } = await withExisting(agentFile("code-reviewer"), { interactive: true });
      expect(await run(["add", "code-reviewer"], io)).toBe(0);
      expect(io.questions).toEqual([]);
      expect(io.output()).toContain("sub-agent code-reviewer is already up to date");
    });

    test("never overwrites without asking when not interactive", async () => {
      const { io, dest } = await withExisting("my edits");
      expect(await run(["add", "code-reviewer"], io)).toBe(1);
      expect(await read(dest)).toBe("my edits");
      expect(io.stderr.join("\n")).toContain("Skipped sub-agent code-reviewer");
      expect(io.stderr.join("\n")).toContain("--force");
    });

    test("asks before overwriting, and respects no", async () => {
      const { io, dest } = await withExisting("my edits", { interactive: true, answers: [false] });
      expect(await run(["add", "code-reviewer"], io)).toBe(1);
      expect(io.questions).toEqual(["Overwrite?"]);
      expect(await read(dest)).toBe("my edits");
    });

    test("asks before overwriting, and overwrites on yes", async () => {
      const { io, dest } = await withExisting("my edits", { interactive: true, answers: [true] });
      expect(await run(["add", "code-reviewer"], io)).toBe(0);
      expect(await read(dest)).toBe(agentFile("code-reviewer"));
      expect(io.output()).toContain("✔ Updated sub-agent code-reviewer");
    });

    test("--force overwrites without asking", async () => {
      const { io, dest } = await withExisting("my edits", { interactive: true });
      expect(await run(["add", "code-reviewer", "--force"], io)).toBe(0);
      expect(io.questions).toEqual([]);
      expect(await read(dest)).toBe(agentFile("code-reviewer"));
    });

    test("keeps extra files the user added to a skill folder", async () => {
      const io = await testIo();
      const extra = path.join(io.cwd, ".claude/skills/changelog/NOTES.md");
      await mkdir(path.dirname(extra), { recursive: true });
      await writeFile(extra, "mine");
      expect(await run(["add", "changelog"], io)).toBe(0);
      expect(await read(extra)).toBe("mine");
    });
  });
});

describe("registry access", () => {
  test("uses HELLOAGENTS_REGISTRY_URL when set", async () => {
    const { files } = buildFakeRegistry();
    const fetch = fakeFetch(files, "http://localhost:4321/r");
    const io = await testIo({
      fetch: fetch as unknown as typeof globalThis.fetch,
      env: { HELLOAGENTS_REGISTRY_URL: "http://localhost:4321/r/" },
    });
    expect(await run(["add", "debugger"], io)).toBe(0);
    expect(fetch.mock.calls.map((c) => String(c[0]))).toEqual([
      "http://localhost:4321/r/registry.json",
      "http://localhost:4321/r/agents/debugger.md",
    ]);
  });

  test("can install from a local folder", async () => {
    const { files } = buildFakeRegistry();
    const dir = await tempDir();
    for (const [rel, content] of files) {
      await mkdir(path.dirname(path.join(dir, rel)), { recursive: true });
      await writeFile(path.join(dir, rel), content);
    }
    const io = await testIo({ env: { HELLOAGENTS_REGISTRY_URL: dir } });
    expect(await run(["add", "changelog"], io)).toBe(0);
    expect(await read(path.join(io.cwd, ".claude/skills/changelog/SKILL.md"))).toContain(
      "changelog",
    );
  });

  test("explains network failures", async () => {
    const fetch = async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }),
      });
    };
    const io = await testIo({ fetch: fetch as unknown as typeof globalThis.fetch });
    expect(await run(["list"], io)).toBe(1);
    expect(io.stderr.join("\n")).toBe(
      `✖ Couldn't reach the registry at ${BASE} (ENOTFOUND).\nCheck your internet connection, or set HELLOAGENTS_REGISTRY_URL to use a different registry.`,
    );
  });

  test("reports HTTP errors", async () => {
    const io = await testIo({ files: new Map() });
    expect(await run(["list"], io)).toBe(1);
    expect(io.output()).toContain(`The registry returned HTTP 404 for ${BASE}/registry.json`);
  });

  test("rejects files whose checksum doesn't match", async () => {
    const { files } = buildFakeRegistry();
    files.set("agents/debugger.md", "tampered");
    const io = await testIo({ files });
    expect(await run(["add", "debugger"], io)).toBe(1);
    expect(io.output()).toContain("doesn't match the registry checksum");
    await expect(readdir(io.cwd)).rejects.toThrow();
  });

  test.each([
    ["path traversal", "skills/evil/../../../.bashrc"],
    ["a path outside the entry's folder", "skills/other/SKILL.md"],
    ["an absolute path", "/etc/passwd"],
  ])("refuses a registry containing %s", async (_label, badPath) => {
    const { files } = buildFakeRegistry([
      { name: "evil", type: "skill", files: { [badPath]: "x" } },
    ]);
    const io = await testIo({ files });
    expect(await run(["add", "evil"], io)).toBe(1);
    expect(io.output()).toContain(`unsafe file path "${badPath}"`);
  });

  test("asks the user to upgrade when the registry format is newer", async () => {
    const files = new Map([["registry.json", JSON.stringify({ version: 2, entries: [] })]]);
    const io = await testIo({ files });
    expect(await run(["list"], io)).toBe(1);
    expect(io.output()).toContain("npx @helloagents/cli@latest");
  });

  test("reports invalid JSON", async () => {
    const io = await testIo({ files: new Map([["registry.json", "<html>"]]) });
    expect(await run(["list"], io)).toBe(1);
    expect(io.output()).toContain("returned invalid JSON");
  });
});
