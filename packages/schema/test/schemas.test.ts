import { describe, expect, test } from "vitest";
import { agentFrontmatterSchema, skillFrontmatterSchema } from "../src/schemas.js";

const base = { name: "code-reviewer", description: "Reviews code." };

function messages(result: {
  success: boolean;
  error?: { issues: { path: PropertyKey[]; message: string }[] };
}) {
  return result.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [];
}

describe("agentFrontmatterSchema", () => {
  test("accepts the minimal form", () => {
    expect(agentFrontmatterSchema.safeParse(base).success).toBe(true);
  });

  test("accepts every documented optional field", () => {
    const result = agentFrontmatterSchema.safeParse({
      ...base,
      tools: "Read, Grep, Glob",
      disallowedTools: ["Write"],
      model: "sonnet",
      permissionMode: "plan",
      maxTurns: 20,
      skills: ["changelog"],
      memory: "project",
      background: false,
      effort: "high",
      isolation: "worktree",
      color: "blue",
      category: "code-quality",
      tags: ["review", "quality"],
      author: "@octocat",
    });
    expect(result.success).toBe(true);
    expect(result.data?.author).toBe("octocat");
  });

  test.each(["sonnet", "opus", "haiku", "fable", "inherit", "claude-sonnet-5"])(
    "accepts model %s",
    (model) => {
      expect(agentFrontmatterSchema.safeParse({ ...base, model }).success).toBe(true);
    },
  );

  test.each([
    [{ name: "Code_Reviewer" }, "name: must be lowercase"],
    [{ name: "-reviewer" }, "name: must be lowercase"],
    [{ name: "a--b" }, "name: must be lowercase"],
    [{ name: "x".repeat(65) }, "name: must be at most 64"],
    [{ description: "   " }, "description: is required"],
    [{ description: "x".repeat(1025) }, "description: must be at most 1024"],
    [{ model: "gpt-5" }, "model: must be sonnet, opus"],
    [{ tools: [] }, "tools:"],
    [{ maxTurns: 0 }, "maxTurns:"],
    [{ category: "misc" }, "category:"],
    [{ tags: ["Review"] }, "tags.0: tags must be lowercase"],
    [{ tags: ["a", "a"] }, "tags: tags must not repeat"],
    [{ tags: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }, "tags: at most 8 tags"],
    [{ author: "not a handle" }, "author: must be a GitHub username"],
  ])("rejects %o", (override, expected) => {
    const result = agentFrontmatterSchema.safeParse({ ...base, ...override });
    expect(result.success).toBe(false);
    expect(messages(result).join("\n")).toContain(expected);
  });
});

describe("skillFrontmatterSchema", () => {
  const skill = { name: "changelog", description: "Writes changelogs." };

  test("accepts spec and Claude Code fields", () => {
    const result = skillFrontmatterSchema.safeParse({
      ...skill,
      when_to_use: "When releasing.",
      "argument-hint": "[version]",
      "disable-model-invocation": "no",
      "user-invocable": true,
      "allowed-tools": "Bash(git log:*) Read",
      context: "fork",
      shell: "PowerShell",
      license: "MIT",
      compatibility: "Requires git",
      metadata: { owner: "docs-team" },
    });
    expect(result.success).toBe(true);
  });

  test.each([
    [{ name: "synced" }, "name: is reserved"],
    [{ name: "anthropic-skills-foo" }, "name: is reserved"],
    [
      { description: "x".repeat(1000), when_to_use: "y".repeat(600) },
      "together must be at most 1536",
    ],
    [{ metadata: { version: 2 } }, "metadata.version:"],
    [{ shell: "zsh" }, "shell: must be bash or powershell"],
    [{ "user-invocable": "maybe" }, "user-invocable:"],
    [{ compatibility: "x".repeat(501) }, "compatibility: must be at most 500"],
  ])("rejects %o", (override, expected) => {
    const result = skillFrontmatterSchema.safeParse({ ...skill, ...override });
    expect(result.success).toBe(false);
    expect(messages(result).join("\n")).toContain(expected);
  });
});
