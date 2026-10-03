interface FileDiff {
  path: string;
  added: number;
  removed: number;
  lines: string[];
}

/** Splits `git diff` output into files. */
export function parseDiff(diff: string): FileDiff[] {
  const files: FileDiff[] = [];
  let current: FileDiff | undefined;
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = / b\/(.+)$/.exec(line)?.[1] ?? line;
      current = { path, added: 0, removed: 0, lines: [] };
      files.push(current);
      continue;
    }
    if (!current || /^(index |--- |\+\+\+ |new file|deleted file|similarity|rename )/.test(line))
      continue;
    if (line.startsWith("+")) current.added++;
    else if (line.startsWith("-")) current.removed++;
    current.lines.push(line);
  }
  return files;
}

export function Diff({ diff }: { diff: string }) {
  const files = parseDiff(diff);
  if (!files.length) return <p className="empty">No changes yet.</p>;
  return (
    <div className="diff-list">
      {files.map((f) => (
        <section key={f.path} className="diff-file">
          <header>
            <span className="mono">{f.path}</span>
            <span className="mono">
              <span className="add">+{f.added}</span> <span className="del">−{f.removed}</span>
            </span>
          </header>
          <pre>
            {f.lines.map((l, i) => (
              <span
                key={i}
                className={
                  l.startsWith("@@")
                    ? "hunk"
                    : l.startsWith("+")
                      ? "add-line"
                      : l.startsWith("-")
                        ? "del-line"
                        : ""
                }
              >
                {l || " "}
              </span>
            ))}
          </pre>
        </section>
      ))}
    </div>
  );
}
