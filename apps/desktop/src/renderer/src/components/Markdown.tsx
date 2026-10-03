import { Fragment, type ReactNode } from "react";

// A small Markdown renderer for agent output: headings, paragraphs, lists,
// quotes, code, tables, bold, italics and links. It builds React elements
// directly (never HTML strings), so text from an agent can't inject markup.

const INLINE =
  /(`+)([\s\S]+?)\1|\*\*(.+?)\*\*|__(.+?)__|(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?!\w)|(?<![\w_])_(?!\s)(.+?)(?<!\s)_(?!\w)|\[([^\]]+)\]\(([^)\s]+)\)/g;

function inline(text: string, key = ""): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let n = 0;
  for (const m of text.matchAll(INLINE)) {
    const at = m.index;
    if (at > last) out.push(text.slice(last, at));
    const k = `${key}${n++}`;
    const [, , code, bold, bold2, em, em2, label, href] = m;
    if (code !== undefined) out.push(<code key={k}>{code.trim()}</code>);
    else if (bold !== undefined || bold2 !== undefined)
      out.push(<strong key={k}>{inline(bold ?? bold2 ?? "", `${k}-`)}</strong>);
    else if (em !== undefined || em2 !== undefined)
      out.push(<em key={k}>{inline(em ?? em2 ?? "", `${k}-`)}</em>);
    else if (label !== undefined && href !== undefined)
      out.push(<Link key={k} href={href} label={label} />);
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Link({ href, label }: { href: string; label: string }) {
  const web = /^https?:\/\//i.test(href);
  if (!web) return <span title={href}>{label}</span>;
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void window.helloagents.openExternal(href);
      }}
    >
      {label}
    </a>
  );
}

const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TABLE_RULE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim());

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    const k = String(i);

    if (!line.trim()) {
      i++;
      continue;
    }

    const fence = /^\s*(```|~~~)/.exec(line);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] ?? "").trim().startsWith(fence[1] ?? "```"))
        body.push(lines[i++] ?? "");
      i++;
      blocks.push(
        <pre key={k} className="md-code">
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      const level = Math.min((heading[1] ?? "#").length, 3);
      blocks.push(
        <p key={k} className={`md-h md-h${level}`}>
          {inline(heading[2] ?? "")}
        </p>,
      );
      i++;
      continue;
    }

    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push(<hr key={k} />);
      i++;
      continue;
    }

    if (line.includes("|") && TABLE_RULE.test(lines[i + 1] ?? "")) {
      const head = cells(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && (lines[i] ?? "").includes("|") && (lines[i] ?? "").trim())
        rows.push(cells(lines[i++] ?? ""));
      blocks.push(
        <div key={k} className="md-table">
          <table>
            <thead>
              <tr>
                {head.map((c, j) => (
                  <th key={j}>{inline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, j) => (
                    <td key={j}>{inline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^\s*>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i] ?? ""))
        body.push((lines[i++] ?? "").replace(/^\s*>\s?/, ""));
      blocks.push(
        <blockquote key={k}>
          <Markdown text={body.join("\n")} />
        </blockquote>,
      );
      continue;
    }

    const first = LIST_ITEM.exec(line);
    if (first) {
      const ordered = /\d/.test(first[2] ?? "");
      const items: Array<{ depth: number; text: string }> = [];
      while (i < lines.length) {
        const m = LIST_ITEM.exec(lines[i] ?? "");
        if (m) {
          items.push({ depth: Math.min(Math.floor((m[1] ?? "").length / 2), 3), text: m[3] ?? "" });
          i++;
        } else if ((lines[i] ?? "").trim() && /^\s{2,}/.test(lines[i] ?? "") && items.length) {
          // A wrapped continuation line belongs to the item above it.
          const prev = items[items.length - 1];
          if (prev) prev.text += ` ${(lines[i] ?? "").trim()}`;
          i++;
        } else break;
      }
      const start = ordered ? Number.parseInt(first[2] ?? "1", 10) : undefined;
      const List = ordered ? "ol" : "ul";
      blocks.push(
        <List key={k} start={start}>
          {items.map((it, j) => (
            <li key={j} style={it.depth ? { marginLeft: `${it.depth * 18}px` } : undefined}>
              {inline(it.text)}
            </li>
          ))}
        </List>,
      );
      continue;
    }

    // A paragraph runs until a blank line or the start of another block.
    const para: string[] = [];
    while (i < lines.length) {
      const l = lines[i] ?? "";
      if (!l.trim() || /^\s*(```|~~~|#{1,6}\s|>)/.test(l) || LIST_ITEM.test(l)) break;
      if (l.includes("|") && TABLE_RULE.test(lines[i + 1] ?? "")) break;
      para.push(l.trim());
      i++;
    }
    // Always take at least one line, so odd input (an indented "# x") can't stall the loop.
    if (!para.length) para.push((lines[i++] ?? "").trim());
    blocks.push(
      <p key={k}>
        {para.map((l, j) => (
          <Fragment key={j}>
            {j > 0 ? <br /> : null}
            {inline(l, `${j}-`)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="md">{blocks}</div>;
}
