import { useEffect, useState } from "react";
import type { AppInfo } from "../../shared/api";
import { Logo } from "./Logo";

type Check = { label: string; state: "ok" | "bad" | "later" | "pending"; detail: string };

function checksFor(info: AppInfo | undefined): Check[] {
  if (!info) {
    return [
      { label: "Engine", state: "pending", detail: "Starting…" },
      { label: "Claude Code", state: "pending", detail: "Looking for the claude command…" },
      { label: "Claude API key", state: "pending", detail: "" },
    ];
  }
  const cc = info.claudeCode;
  return [
    { label: "Engine", state: "ok", detail: `v${info.engineVersion} · Electron ${info.electron}` },
    cc.installed
      ? {
          label: "Claude Code",
          state: "ok",
          detail: `v${cc.version ?? "unknown"} · workers will use your Claude plan`,
        }
      : { label: "Claude Code", state: "bad", detail: cc.problem ?? "Not found." },
    {
      label: "Claude API key",
      state: "later",
      detail: "Not needed yet. Only your own harness and evals use it.",
    },
  ];
}

const NEXT = [
  ["Harness", "Your own agent loop on the Claude API"],
  ["Traces", "Every model and tool call, saved and searchable"],
  ["Orchestrator", "Split a task across agents, each in its own worktree"],
  ["Evals", "Measure whether the orchestration actually helps"],
];

export function App() {
  const [info, setInfo] = useState<AppInfo>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    window.helloagents.getInfo().then(setInfo, (e: unknown) => setError(String(e)));
  }, []);

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <Logo />
          helloagents
        </div>
        <span className="pill">
          <span className="dot ok" /> local
        </span>
      </header>

      <main className="main">
        <section className="hero">
          <h1>Give it a coding task.</h1>
          <p>
            It splits the work across several agents, sends failing tests back to whoever wrote the
            code, and hands you one change to merge.
          </p>
        </section>

        <section className="card" aria-labelledby="checks-title">
          <h2 id="checks-title" className="label">
            This machine
          </h2>
          {error ? <p className="bad-text">Couldn't reach the engine: {error}</p> : null}
          <ul className="checks">
            {checksFor(info).map((c) => (
              <li key={c.label}>
                <span className={`mark ${c.state}`} aria-hidden="true">
                  {c.state === "ok"
                    ? "✓"
                    : c.state === "bad"
                      ? "!"
                      : c.state === "later"
                        ? "–"
                        : ""}
                </span>
                <span>
                  <span className="check-label">{c.label}</span>
                  <span className="check-detail">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="card" aria-labelledby="next-title">
          <h2 id="next-title" className="label">
            Coming next
          </h2>
          <ol className="next">
            {NEXT.map(([name, what]) => (
              <li key={name}>
                <b>{name}</b>
                <span>{what}</span>
              </li>
            ))}
          </ol>
          <button className="btn" disabled title="Arrives with the orchestrator">
            Open a repository
          </button>
        </section>
      </main>
    </div>
  );
}
