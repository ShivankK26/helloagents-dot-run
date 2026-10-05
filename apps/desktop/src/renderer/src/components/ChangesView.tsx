import { useState } from "react";
import { parseDiff } from "./Diff";
import { Icon } from "./Icons";

/** Review view: changed files on the left, the selected file's diff at full width. */
export function ChangesView({
  diff,
  loading,
  error,
}: {
  diff: string;
  loading: boolean;
  error?: string;
}) {
  const files = parseDiff(diff);
  const [picked, setPicked] = useState<string>();
  const current = files.find((f) => f.path === picked) ?? files[0];

  if (!files.length) {
    return (
      <div className="changes-empty">
        <Icon name="file" size={20} />
        <p>
          {loading
            ? "Loading changes…"
            : error
              ? `Couldn't read the changes: ${error}`
              : "No files changed in this run."}
        </p>
      </div>
    );
  }
  const added = files.reduce((n, f) => n + f.added, 0);
  const removed = files.reduce((n, f) => n + f.removed, 0);

  return (
    <div className="changes">
      <nav className="tree" aria-label="Changed files">
        <div className="label">
          {files.length} file{files.length === 1 ? "" : "s"} · <span className="add">+{added}</span>{" "}
          <span className="del">−{removed}</span>
        </div>
        {files.map((f) => (
          <button
            key={f.path}
            className="tree-row"
            aria-current={current?.path === f.path}
            onClick={() => setPicked(f.path)}
            title={f.path}
          >
            <Icon name="file" size={14} />
            <span className="tree-path">{f.path}</span>
            <span className="tree-n">
              {f.added ? <span className="add">+{f.added}</span> : null}{" "}
              {f.removed ? <span className="del">−{f.removed}</span> : null}
            </span>
          </button>
        ))}
      </nav>
      {current ? (
        <section className="dfile" aria-label={current.path}>
          <header>
            <span>{current.path}</span>
            <span>
              <span className="add">+{current.added}</span>{" "}
              <span className="del">−{current.removed}</span>
            </span>
          </header>
          <pre>
            {current.lines.map((l, i) => (
              <span
                key={i}
                className={
                  l.startsWith("@@")
                    ? "hunk"
                    : l.startsWith("+")
                      ? "a"
                      : l.startsWith("-")
                        ? "d"
                        : ""
                }
              >
                {l || " "}
              </span>
            ))}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
