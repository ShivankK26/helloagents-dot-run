import { describe, expect, test } from "vitest";
import { FrontmatterError, parseMarkdown } from "../src/frontmatter.js";

describe("parseMarkdown", () => {
  test("splits frontmatter and body", () => {
    const { data, body } = parseMarkdown("---\nname: foo\ntags: [a, b]\n---\n\n# Hello\n");
    expect(data).toEqual({ name: "foo", tags: ["a", "b"] });
    expect(body).toBe("\n# Hello\n");
  });

  test("handles CRLF line endings and a BOM", () => {
    const { data, body } = parseMarkdown("﻿---\r\nname: foo\r\n---\r\nbody");
    expect(data).toEqual({ name: "foo" });
    expect(body).toBe("body");
  });

  test("allows an empty frontmatter block", () => {
    expect(parseMarkdown("---\n---\nbody")).toEqual({ data: {}, body: "body" });
  });

  test("does not treat --- inside the body as a second block", () => {
    const { body } = parseMarkdown("---\nname: foo\n---\nabove\n---\nbelow\n");
    expect(body).toBe("above\n---\nbelow\n");
  });

  test.each([
    ["no frontmatter", "# Just markdown", /must start with a `---` line/],
    ["frontmatter not on the first line", "\n---\nname: x\n---\n", /must start with/],
    ["missing closing marker", "---\nname: foo\nbody", /missing its closing `---`/],
    ["invalid YAML", "---\nname: [unclosed\n---\n", /invalid YAML/],
    ["duplicate keys", "---\nname: a\nname: b\n---\n", /invalid YAML/],
    ["a YAML list", "---\n- a\n- b\n---\n", /must be a YAML mapping/],
  ])("rejects %s", (_label, source, message) => {
    expect(() => parseMarkdown(source)).toThrow(FrontmatterError);
    expect(() => parseMarkdown(source)).toThrow(message);
  });
});
