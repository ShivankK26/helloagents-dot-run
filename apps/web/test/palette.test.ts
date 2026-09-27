import { describe, expect, test } from "vitest";
import { rank } from "../src/scripts/palette";

const entries = [
  {
    name: "code-reviewer",
    type: "agent" as const,
    description: "Reviews code changes.",
    category: "code-quality",
    tags: ["review"],
  },
  {
    name: "sql-helper",
    type: "skill" as const,
    description: "Writes SQL for Postgres.",
    category: "data",
    tags: ["sql", "database"],
  },
  {
    name: "changelog",
    type: "skill" as const,
    description: "Writes changelogs from git history.",
    category: "git",
    tags: ["release"],
  },
];
const names = (q: string) => rank(entries, q).map((e) => e.name);

describe("palette rank", () => {
  test("empty query keeps the original order", () => {
    expect(names("  ")).toEqual(["code-reviewer", "sql-helper", "changelog"]);
  });
  test("name matches beat description matches", () => {
    expect(names("sql")).toEqual(["sql-helper"]);
    expect(names("writes")).toEqual(["changelog", "sql-helper"]);
  });
  test("every term has to match", () => {
    expect(names("git history")).toEqual(["changelog"]);
    expect(names("git postgres")).toEqual([]);
  });
  test("matches tags and categories case-insensitively", () => {
    expect(names("DATABASE")).toEqual(["sql-helper"]);
    expect(names("quality")).toEqual(["code-reviewer"]);
  });
});
