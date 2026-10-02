import { describe, expect, test } from "vitest";
import { detectClaudeCode, type RunCommand } from "../src/index";

const fails =
  (code: string): RunCommand =>
  () =>
    Promise.reject(Object.assign(new Error("failed"), { code }));

describe("detectClaudeCode", () => {
  test("reads the version from `claude --version`", async () => {
    const run: RunCommand = async (command, args) => {
      expect([command, ...args]).toEqual(["claude", "--version"]);
      return { stdout: "2.1.287 (Claude Code)\n" };
    };
    expect(await detectClaudeCode(run)).toEqual({ installed: true, version: "2.1.287" });
  });

  test("explains how to install it when the command is missing", async () => {
    const status = await detectClaudeCode(fails("ENOENT"));
    expect(status.installed).toBe(false);
    expect(status.problem).toMatch(/isn't installed/);
  });

  test("reports a CLI that exists but doesn't respond", async () => {
    const status = await detectClaudeCode(fails("ETIMEDOUT"));
    expect(status).toMatchObject({ installed: false });
    expect(status.problem).toMatch(/didn't respond/);
  });
});
