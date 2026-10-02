import { readFile, symlink } from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { runTool, safeEnv, toolDefinitions } from "../src/index";
import { workspace } from "./helpers";

const ctx = (ws: string, allowedCommands: string[] = ["node"]) => ({
  workspace: ws,
  allowedCommands,
});

describe("tool definitions", () => {
  test("every tool has a JSON schema object and streams its input", () => {
    const defs = toolDefinitions();
    expect(defs.map((d) => d.name)).toEqual([
      "list_files",
      "read_file",
      "write_file",
      "edit_file",
      "run_command",
      "finish",
    ]);
    for (const d of defs) {
      expect(d.input_schema.type).toBe("object");
      expect(d.input_schema).not.toHaveProperty("$schema");
      expect(d.eager_input_streaming).toBe(true);
    }
  });
});

describe("path safety", () => {
  test.each(["../outside.txt", "/etc/passwd", "a/../../outside"])("rejects %s", async (p) => {
    const ws = await workspace({ "a.txt": "x" });
    const out = await runTool("read_file", { path: p }, ctx(ws));
    expect(out.ok).toBe(false);
    expect(out.output).toMatch(/outside the workspace/);
  });

  test("rejects a symlink that points outside", async () => {
    const ws = await workspace({ "a.txt": "x" });
    await symlink("/etc", path.join(ws, "escape"));
    const out = await runTool("read_file", { path: "escape/hosts" }, ctx(ws));
    expect(out.output).toMatch(/outside the workspace/);
  });
});

describe("read, write, edit, list", () => {
  test("reads with line numbers, and a range", async () => {
    const ws = await workspace({ "f.js": "a\nb\nc\n" });
    expect((await runTool("read_file", { path: "f.js" }, ctx(ws))).output).toBe(
      "1 | a\n2 | b\n3 | c\n4 | ",
    );
    expect(
      (await runTool("read_file", { path: "f.js", start_line: 2, end_line: 2 }, ctx(ws))).output,
    ).toBe("2 | b");
  });

  test("explains a missing file", async () => {
    const ws = await workspace();
    expect((await runTool("read_file", { path: "nope.js" }, ctx(ws))).output).toMatch(
      /No such file/,
    );
  });

  test("writes files, creating folders", async () => {
    const ws = await workspace();
    const out = await runTool(
      "write_file",
      { path: "src/new/x.ts", content: "export {};\n" },
      ctx(ws),
    );
    expect(out).toMatchObject({ ok: true, output: "Wrote src/new/x.ts (2 lines)" });
    expect(await readFile(path.join(ws, "src/new/x.ts"), "utf8")).toBe("export {};\n");
  });

  test("edits exactly one occurrence", async () => {
    const ws = await workspace({ "f.js": "let a = 1;\nlet b = 1;\n" });
    expect(
      (await runTool("edit_file", { path: "f.js", old_text: "a = 1", new_text: "a = 2" }, ctx(ws)))
        .ok,
    ).toBe(true);
    expect(await readFile(path.join(ws, "f.js"), "utf8")).toBe("let a = 2;\nlet b = 1;\n");
  });

  test("refuses ambiguous or missing edits, with a hint", async () => {
    const ws = await workspace({ "f.js": "x = 1;\nx = 1;\n" });
    expect(
      (await runTool("edit_file", { path: "f.js", old_text: "x = 1", new_text: "y" }, ctx(ws)))
        .output,
    ).toMatch(/appears 2 times/);
    expect(
      (await runTool("edit_file", { path: "f.js", old_text: "zzz", new_text: "y" }, ctx(ws)))
        .output,
    ).toMatch(/not found/);
  });

  test("replacement text containing $ is inserted literally", async () => {
    const ws = await workspace({ "f.js": "price\n" });
    await runTool(
      "edit_file",
      { path: "f.js", old_text: "price", new_text: "$& costs $1" },
      ctx(ws),
    );
    expect(await readFile(path.join(ws, "f.js"), "utf8")).toBe("$& costs $1\n");
  });

  test("lists files and skips node_modules and .git", async () => {
    const ws = await workspace({
      "src/a.ts": "",
      "node_modules/x/i.js": "",
      ".git/HEAD": "",
      "README.md": "",
    });
    expect((await runTool("list_files", {}, ctx(ws))).output).toBe("README.md\nsrc/\n  a.ts");
  });
});

describe("run_command", () => {
  test("runs an allowed program without a shell and reports the exit code", async () => {
    const ws = await workspace();
    const out = await runTool(
      "run_command",
      { command: "node", args: ["-e", "console.log('hi && there')"] },
      ctx(ws),
    );
    expect(out).toEqual({ ok: true, output: "exit code 0\nhi && there" });
  });

  test("a failing command is an error result with its output", async () => {
    const ws = await workspace();
    const out = await runTool(
      "run_command",
      { command: "node", args: ["-e", "console.error('boom'); process.exit(3)"] },
      ctx(ws),
    );
    expect(out.ok).toBe(false);
    expect(out.output).toBe("exit code 3\nboom");
  });

  test("refuses programs that aren't allowed", async () => {
    const ws = await workspace();
    const out = await runTool("run_command", { command: "rm", args: ["-rf", "/"] }, ctx(ws));
    expect(out.output).toMatch(/"rm" isn't allowed/);
  });

  test("stops at the timeout", async () => {
    const ws = await workspace();
    const out = await runTool(
      "run_command",
      { command: "node", args: ["-e", "setTimeout(()=>{}, 10000)"], timeout_seconds: 1 },
      ctx(ws),
    );
    expect(out.output).toMatch(/Stopped after 1s/);
  });

  test("commands don't see API keys or tokens", () => {
    const env = safeEnv({ PATH: "/bin", ANTHROPIC_API_KEY: "sk-x", GITHUB_TOKEN: "t", HOME: "/h" });
    expect(env).toEqual({ PATH: "/bin", HOME: "/h" });
  });
});

describe("input validation", () => {
  test("bad input becomes an error the model can read", async () => {
    const ws = await workspace();
    const out = await runTool("edit_file", { path: "f.js", old_text: "" }, ctx(ws));
    expect(out.ok).toBe(false);
    expect(out.output).toMatch(/Invalid input for edit_file/);
    expect(out.output).toMatch(/new_text/);
  });

  test("unknown tools are reported", async () => {
    expect((await runTool("delete_everything", {}, ctx("/tmp"))).output).toBe(
      'Unknown tool "delete_everything".',
    );
  });
});
