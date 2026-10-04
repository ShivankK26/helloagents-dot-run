import { useEffect, useRef, useState } from "react";
import type { AgentId, ProjectInfo, ProjectRecord, RunSettings } from "../../../shared/api";
import { type AgentOption } from "../agents";
import { EFFORTS, loadSettings, MODELS, modelName, saveSettings } from "../composer";
import { errorText } from "../toast";
import { Icon } from "./Icons";
import { Menu } from "./Menu";

/** The start screen for a project: one question, one box, every choice in reach. */
export function NewTask({
  project,
  info,
  options,
  onStarted,
  onAgentChange,
  onEditActions,
}: {
  project: ProjectRecord;
  info?: ProjectInfo;
  options: AgentOption[];
  onStarted: (runId: string) => void;
  onAgentChange: (agent: AgentId) => void;
  onEditActions: () => void;
}) {
  const api = window.helloagents;
  const [task, setTask] = useState("");
  const [settings, setSettings] = useState<RunSettings>(() => loadSettings(project.id));
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string>();
  const box = useRef<HTMLTextAreaElement>(null);
  const worker = options.find((o) => o.id === project.workerAgent);
  const isClaude = project.workerAgent === "claude-code";
  const branchMode = settings.workspace !== "checkout";

  useEffect(() => box.current?.focus({ preventScroll: true }), []);

  const update = (patch: Partial<RunSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    saveSettings(project.id, next);
  };

  async function start() {
    const text = task.trim();
    if (!text || worker?.unavailable || starting) return;
    setStarting(true);
    setError(undefined);
    try {
      const runSettings: RunSettings = { ...settings };
      if (!runSettings.model) delete runSettings.model;
      const id = await api.startRun(project.id, text, runSettings);
      setTask("");
      onStarted(id);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setStarting(false);
    }
  }

  const checks = info?.actions.checks ?? [];
  const base = settings.base ?? info?.branch ?? "main";

  return (
    <div className="home">
      <div className="lamp" aria-hidden="true">
        <div className="halo" />
        <div className="cone" />
        <div className="bar" />
      </div>
      <h1>
        What should we build in <span className="home-project">{project.name}</span>?
      </h1>
      <p className="home-sub">
        {info ? (
          <>
            {info.branch ?? "HEAD"} is at <code>{info.head}</code> ·{" "}
            {checks.length ? (
              <>
                checks: <code>{checks.join(", ")}</code>
              </>
            ) : (
              "no checks yet"
            )}{" "}
            <button className="link-btn" onClick={onEditActions}>
              {checks.length ? "Edit" : "Add checks"}
            </button>
          </>
        ) : (
          " "
        )}
      </p>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void start();
        }}
      >
        <label htmlFor="task" className="sr">
          Task
        </label>
        <textarea
          id="task"
          ref={box}
          rows={3}
          placeholder="Describe a task, or ask a question about the code…"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void start();
            }
          }}
        />
        <div className="c-row">
          <Menu
            up
            width={330}
            trigger={
              <>
                <span className="agent-mark">✳</span> {worker?.name ?? "Agent"}
                {isClaude ? ` · ${modelName(settings.model)}` : ""}{" "}
                <span className="caret">
                  <Icon name="chevronDown" size={14} />
                </span>
              </>
            }
            items={[
              { header: "Agent" },
              ...options.map((o) => ({
                id: `agent-${o.id}`,
                label: o.name,
                hint: o.unavailable ?? o.billing,
                checked: o.id === project.workerAgent,
                disabled: Boolean(o.unavailable),
                onSelect: () => onAgentChange(o.id),
              })),
              ...(isClaude
                ? [
                    { header: "Model" },
                    ...MODELS.map((m) => ({
                      id: `model-${m.id || "default"}`,
                      label: (
                        <>
                          {m.name}
                          {m.isNew ? <span className="badge-new">NEW</span> : null}
                        </>
                      ),
                      hint: m.hint,
                      checked: (settings.model ?? "") === m.id,
                      onSelect: () => update({ model: m.id || undefined }),
                    })),
                  ]
                : []),
            ]}
          />
          <span className="sep-v" />
          <Menu
            up
            width={260}
            trigger={
              <>
                {EFFORTS.find((e) => e.id === settings.effort)?.name ?? "Default"} effort{" "}
                <span className="caret">
                  <Icon name="chevronDown" size={14} />
                </span>
              </>
            }
            items={[
              { header: "How hard it thinks" },
              ...EFFORTS.map((e) => ({
                id: e.id,
                label: e.name,
                hint: e.hint,
                checked: settings.effort === e.id,
                onSelect: () => update({ effort: e.id }),
              })),
            ]}
          />
          <span className="sep-v" />
          <Menu
            up
            width={340}
            trigger={
              <>
                <Icon name="lock" size={13} />{" "}
                {settings.access === "full" ? "Full access" : "Edits only"}{" "}
                <span className="caret">
                  <Icon name="chevronDown" size={14} />
                </span>
              </>
            }
            items={[
              {
                id: "ask",
                label: "Ask first",
                hint: "Asks before each command or change. Coming soon.",
                disabled: true,
                onSelect: () => undefined,
              },
              {
                id: "edits",
                label: "Edits only",
                hint: "Edits files freely; only runs common build and test commands",
                checked: settings.access !== "full",
                onSelect: () => update({ access: "edits" }),
              },
              {
                id: "full",
                label: "Full access",
                hint: branchMode
                  ? "Any command, no questions. Still on its own branch"
                  : "Any command, no questions, in your own checkout",
                checked: settings.access === "full",
                onSelect: () => update({ access: "full" }),
              },
            ]}
          />
          <span className="sep-v" />
          <span className="chip disabled" title="Several agents on one task, coming soon">
            <Icon name="layers" size={13} /> 1 attempt
          </span>
          <span className="grow" />
          <button
            className="send"
            type="submit"
            disabled={!task.trim() || starting || Boolean(worker?.unavailable)}
            aria-label="Run"
            title="Run (⌘↵)"
          >
            {starting ? <span className="spinner" /> : <Icon name="arrowUp" size={16} />}
          </button>
        </div>
      </form>

      <div className="c-under">
        <Menu
          width={320}
          trigger={
            <>
              <Icon name={branchMode ? "branch" : "folder"} size={13} />{" "}
              {branchMode ? "New branch" : "Current checkout"}{" "}
              <span className="caret">
                <Icon name="chevronDown" size={14} />
              </span>
            </>
          }
          items={[
            { header: "Where it works" },
            {
              id: "branch",
              label: "New branch",
              hint: "Its own copy. Your files are never touched",
              checked: branchMode,
              onSelect: () => update({ workspace: "branch" }),
            },
            {
              id: "checkout",
              label: "Current checkout",
              hint: "Edits your working copy directly",
              checked: !branchMode,
              onSelect: () => update({ workspace: "checkout" }),
            },
          ]}
        />
        <span className="hint">
          {branchMode && info?.actions.setup ? (
            <>
              runs <code>{info.actions.setup}</code> first
            </>
          ) : !branchMode ? (
            "changes land in your working copy"
          ) : null}
        </span>
        {branchMode ? (
          <Menu
            align="right"
            width={240}
            trigger={
              <>
                <Icon name="branch" size={13} /> from {base}{" "}
                <span className="caret">
                  <Icon name="chevronDown" size={14} />
                </span>
              </>
            }
            items={[
              { header: "Start from" },
              ...(info?.branches.length ? info.branches : [base]).slice(0, 12).map((b) => ({
                id: b,
                label: b,
                hint: b === info?.branch ? "current" : undefined,
                checked: b === base,
                onSelect: () => update({ base: b === info?.branch ? undefined : b }),
              })),
            ]}
          />
        ) : null}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </div>
  );
}
