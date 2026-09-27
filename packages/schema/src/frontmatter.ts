import { parseDocument } from "yaml";

export interface ParsedMarkdown {
  data: Record<string, unknown>;
  body: string;
}

export class FrontmatterError extends Error {}

const FRONTMATTER = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;

/**
 * Splits a markdown file into YAML frontmatter and body. Claude Code only reads
 * frontmatter when `---` is the very first line, so we require the same.
 */
export function parseMarkdown(source: string): ParsedMarkdown {
  const text = source.replace(/^\uFEFF/, "");
  if (!/^---[ \t]*\r?\n/.test(text)) {
    throw new FrontmatterError("must start with a `---` line followed by YAML frontmatter");
  }
  const match = FRONTMATTER.exec(text);
  if (!match) {
    throw new FrontmatterError("frontmatter is missing its closing `---` line");
  }
  const yamlSource = match[1] ?? "";
  const body = text.slice(match[0].length);

  const doc = parseDocument(yamlSource, { uniqueKeys: true, prettyErrors: false });
  const firstError = doc.errors[0];
  if (firstError) {
    // +1 because the opening `---` is line 1 of the file.
    const line = yamlSource.slice(0, firstError.pos[0]).split("\n").length + 1;
    throw new FrontmatterError(
      `invalid YAML on line ${line}: ${firstError.message.split("\n")[0]}`,
    );
  }
  const data: unknown = doc.toJS();
  if (data === null || data === undefined) {
    return { data: {}, body };
  }
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new FrontmatterError("frontmatter must be a YAML mapping of `key: value` pairs");
  }
  return { data: data as Record<string, unknown>, body };
}
