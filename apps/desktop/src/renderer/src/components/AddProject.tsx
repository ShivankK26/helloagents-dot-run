import { useEffect, useState } from "react";
import type { AgentId, FolderInfo, ProjectRecord } from "../../../shared/api";
import type { AgentOption } from "../agents";
import { AgentSelect } from "./AgentSelect";
import { Icon } from "./Icons";

type Step =
  | { kind: "choose" }
  | { kind: "clone" }
  | { kind: "busy"; message: string }
  | { kind: "review"; folder: FolderInfo };

export function AddProject({
  options,
  onClose,
  onAdded,
}: {
  options: AgentOption[];
  onClose: () => void;
  onAdded: (projects: ProjectRecord[]) => void;
}) {
  const api = window.helloagents;
  const firstAvailable = options.find((o) => !o.unavailable)?.id ?? "claude-code";
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [worker, setWorker] = useState<AgentId>(firstAvailable);
  const [planner, setPlanner] = useState<AgentId>(firstAvailable);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function review(path: string) {
    setError(undefined);
    setStep({ kind: "busy", message: "Looking at the folder…" });
    const folder = await api.inspectFolder(path);
    setName(folder.name);
    setPicked(new Set(folder.childRepos.map((r) => r.path)));
    setStep({ kind: "review", folder });
  }

  async function chooseFolder() {
    const path = await api.chooseFolder();
    if (path) await review(path);
  }

  async function clone() {
    if (!url.trim()) return;
    setError(undefined);
    setStep({ kind: "busy", message: "Cloning…" });
    try {
      const path = await api.cloneRepo(url.trim());
      if (path) await review(path);
      else setStep({ kind: "clone" });
    } catch (e) {
      setError(`Couldn't clone: ${e instanceof Error ? e.message : String(e)}`);
      setStep({ kind: "clone" });
    }
  }

  async function add(folder: FolderInfo) {
    const targets = folder.isRepo
      ? [{ path: folder.path, name: name.trim() || folder.name }]
      : folder.childRepos.filter((r) => picked.has(r.path));
    const added: ProjectRecord[] = [];
    for (const t of targets)
      added.push(
        await api.addProject({
          path: t.path,
          name: t.name,
          workerAgent: worker,
          plannerAgent: planner,
        }),
      );
    onAdded(added);
  }

  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <header className="dialog-head">
          {step.kind !== "choose" ? (
            <button
              className="icon-btn"
              onClick={() => setStep({ kind: "choose" })}
              aria-label="Back"
            >
              <Icon name="back" />
            </button>
          ) : null}
          <div>
            <h2 id="add-title">Add a project</h2>
            {step.kind === "choose" ? (
              <p>
                Agents work on a git repository. Each run gets its own branch, so your working copy
                is never touched.
              </p>
            ) : null}
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>

        {step.kind === "choose" ? (
          <div className="choices">
            <button className="choice" onClick={chooseFolder}>
              <span className="choice-icon">
                <Icon name="folder" size={18} />
              </span>
              <span>
                <b>Open a folder on this Mac</b>
                <small>A repository, or a folder that holds several</small>
              </span>
            </button>
            <button className="choice" onClick={() => setStep({ kind: "clone" })}>
              <span className="choice-icon">
                <Icon name="git" size={18} />
              </span>
              <span>
                <b>Clone from Git</b>
                <small>Start from an HTTPS or SSH URL</small>
              </span>
            </button>
          </div>
        ) : null}

        {step.kind === "clone" ? (
          <form
            className="dialog-body"
            onSubmit={(e) => {
              e.preventDefault();
              void clone();
            }}
          >
            <div className="field">
              <label htmlFor="clone-url">Repository URL</label>
              <input
                id="clone-url"
                autoFocus
                placeholder="https://github.com/you/project.git"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <span className="field-hint">You'll choose where to put it next.</span>
            </div>
            {error ? <p className="error-text">{error}</p> : null}
            <div className="dialog-actions">
              <button className="btn btn-primary" type="submit" disabled={!url.trim()}>
                Choose folder and clone
              </button>
            </div>
          </form>
        ) : null}

        {step.kind === "busy" ? (
          <div className="dialog-body">
            <p className="muted">
              <span className="spinner" /> {step.message}
            </p>
          </div>
        ) : null}

        {step.kind === "review" ? (
          <div className="dialog-body">
            <div className="path-row">
              <Icon name="folder" />
              <span className="mono">{step.folder.path.replace(/^\/Users\/[^/]+/, "~")}</span>
              <button className="link-btn" onClick={chooseFolder}>
                Change
              </button>
            </div>

            {step.folder.isRepo ? (
              <>
                {!step.folder.hasCommits ? (
                  <p className="warn-text">
                    This repository has no commits yet. Make a first commit before running agents.
                  </p>
                ) : null}
                <div className="field">
                  <label htmlFor="project-name">Name</label>
                  <input id="project-name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
              </>
            ) : step.folder.childRepos.length ? (
              <div className="field">
                <span className="field-label">
                  This folder holds {step.folder.childRepos.length} repositories. Add:
                </span>
                <div className="checklist">
                  {step.folder.childRepos.map((r) => (
                    <label key={r.path} className="check-row">
                      <input
                        type="checkbox"
                        checked={picked.has(r.path)}
                        onChange={(e) => {
                          const next = new Set(picked);
                          if (e.target.checked) next.add(r.path);
                          else next.delete(r.path);
                          setPicked(next);
                        }}
                      />
                      <span>{r.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <p className="error-text">
                This folder isn't a git repository and doesn't contain any. helloagents needs git to
                give each agent its own branch. Run <code>git init</code> there, or choose another
                folder.
              </p>
            )}

            {step.folder.isRepo || step.folder.childRepos.length ? (
              <>
                <div className="field-pair">
                  <AgentSelect
                    id="worker"
                    label="Worker agent"
                    value={worker}
                    options={options}
                    onChange={setWorker}
                    hint="Does the coding."
                  />
                  <AgentSelect
                    id="planner"
                    label="Planner agent"
                    value={planner}
                    options={options}
                    onChange={setPlanner}
                    hint="Splits big tasks across agents."
                  />
                </div>
                <div className="dialog-actions">
                  <button className="btn" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => void add(step.folder)}
                    disabled={!step.folder.isRepo && picked.size === 0}
                  >
                    {step.folder.isRepo
                      ? "Add project"
                      : `Add ${picked.size} project${picked.size === 1 ? "" : "s"}`}
                  </button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
