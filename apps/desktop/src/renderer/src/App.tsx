import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentId,
  AgentProvider,
  AppInfo,
  Opener,
  ProjectInfo,
  ProjectRecord,
  RunListItem,
  ShipKind,
  ThemeMode,
} from "../../shared/api";
import { agentOptions } from "./agents";
import { copyOnSelect } from "./copyOnSelect";
import { ActionsDialog } from "./components/ActionsDialog";
import { AddProject } from "./components/AddProject";
import { ErrorsPage } from "./components/ErrorsPage";
import { EvalsPage } from "./components/EvalsPage";
import { Icon } from "./components/Icons";
import { Menu } from "./components/Menu";
import { NewTask } from "./components/NewTask";
import { Overview } from "./components/Overview";
import { Palette, type Command } from "./components/Palette";
import { RemoveProject } from "./components/RemoveProject";
import { RunScreen, type RunTab } from "./components/RunScreen";
import { Sidebar, type Section } from "./components/Sidebar";
import { Toasts } from "./components/Toasts";
import { TracesPage } from "./components/TracesPage";
import { Welcome } from "./components/Welcome";
import { Logo } from "./Logo";
import { outcomeOf } from "./outcome";
import { applyTheme, savedTheme, watchSystemTheme } from "./theme";
import { errorText, showToast } from "./toast";

type Screen =
  | { kind: "home" }
  | { kind: "run"; runId: string; tab: RunTab }
  | { kind: "section"; section: Section };

const PIN_KEY = "helloagents.sidebarPinned";
const readPinned = () => {
  try {
    return localStorage.getItem(PIN_KEY) !== "0";
  } catch {
    return true;
  }
};

export function App() {
  const api = window.helloagents;
  useEffect(() => copyOnSelect(), []);
  const [info, setInfo] = useState<AppInfo>();
  const [agents, setAgents] = useState<AgentProvider[]>([]);
  const [openers, setOpeners] = useState<Opener[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>();
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [errorCount, setErrorCount] = useState(0);
  const [projectId, setProjectId] = useState<string>();
  const [projectInfo, setProjectInfo] = useState<ProjectInfo>();
  const [screen, setScreen] = useState<Screen>({ kind: "home" });
  const [pinned, setPinned] = useState(readPinned);
  const [peek, setPeek] = useState(false);
  const [palette, setPalette] = useState(false);
  const [editingActions, setEditingActions] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [projectErrors, setProjectErrors] = useState<Record<string, number>>({});
  const [theme, setTheme] = useState<ThemeMode>(savedTheme);
  const [resolved, setResolved] = useState<"light" | "dark">(() => applyTheme(savedTheme()));

  // ---- Data ----
  const loadProjects = useCallback(
    () =>
      api.listProjects().then((list) => {
        setProjects(list);
        setProjectId((id) => (id && list.some((p) => p.id === id) ? id : list[0]?.id));
        return list;
      }),
    [api],
  );
  const loadRuns = useCallback(() => {
    void api.listAllRuns(200).then(setRuns);
    void api.listErrors().then((l) => {
      setErrorCount(l.length);
      const byProject: Record<string, number> = {};
      for (const e of l)
        if (e.projectId) byProject[e.projectId] = (byProject[e.projectId] ?? 0) + 1;
      setProjectErrors(byProject);
    });
  }, [api]);

  useEffect(() => {
    void api.getInfo().then(setInfo);
    void api.detectAgents().then(setAgents);
    void api.listOpeners().then(setOpeners);
    void loadProjects();
    loadRuns();
    const offChange = api.onRunChanged(() => loadRuns());
    const offOpen = api.onOpenRun((id) => showRun(id));
    return () => {
      offChange();
      offOpen();
    };
    // showRun is stable enough here: it only reads setters and api.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, loadProjects, loadRuns]);

  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    api.projectInfo(projectId).then(
      (pi) => {
        if (!alive) return;
        setProjectInfo(pi);
        // Actions may have just been detected for the first time.
        void loadProjects();
      },
      () => alive && setProjectInfo(undefined),
    );
    return () => {
      alive = false;
    };
  }, [api, projectId, loadProjects]);

  // ---- Theme ----
  const setMode = useCallback((mode: ThemeMode) => {
    setTheme(mode);
    setResolved(applyTheme(mode));
  }, []);
  useEffect(
    () => watchSystemTheme(() => theme === "system" && setResolved(applyTheme("system"))),
    [theme],
  );
  const toggleTheme = useCallback(
    () => setMode(resolved === "dark" ? "light" : "dark"),
    [resolved, setMode],
  );

  // ---- Navigation ----
  const project = projects?.find((p) => p.id === projectId);
  const openProject = useCallback((id: string) => {
    setProjectId(id);
    setScreen({ kind: "home" });
  }, []);
  function showRun(runId: string, tab: RunTab = "activity") {
    void api.getRun(runId).then((run) => {
      if (run?.projectId) setProjectId(run.projectId);
      setScreen({ kind: "run", runId, tab });
    });
  }
  // Peeking: open on the left edge, close a moment after the mouse leaves (no flicker).
  const peekTimer = useRef<number>(undefined);
  const openPeek = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    setPeek(true);
  }, []);
  const closePeekSoon = useCallback(() => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(false), 180);
  }, []);
  const togglePin = useCallback(() => {
    setPinned((p) => {
      try {
        localStorage.setItem(PIN_KEY, p ? "0" : "1");
      } catch {
        // not remembered
      }
      return !p;
    });
    setPeek(false);
  }, []);

  // ---- Keyboard ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "k") {
        e.preventDefault();
        setPalette((p) => !p);
      } else if (k === "b" && !e.shiftKey) {
        e.preventDefault();
        togglePin();
      } else if (k === "l" && e.shiftKey) {
        e.preventDefault();
        toggleTheme();
      } else if (k === "0") {
        e.preventDefault();
        setScreen({ kind: "section", section: "overview" });
      } else if (k === "n" && !e.shiftKey) {
        e.preventDefault();
        setScreen({ kind: "home" });
      } else if (/^[1-9]$/.test(k) && projects) {
        const p = projects[Number(k) - 1];
        if (p) {
          e.preventDefault();
          openProject(p.id);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePin, toggleTheme, projects, openProject]);

  const options = agentOptions(agents, info);
  const projectRuns = runs.filter((r) => r.projectId);
  const currentRun = screen.kind === "run" ? runs.find((r) => r.id === screen.runId) : undefined;

  async function changeAgent(agent: AgentId) {
    if (!project) return;
    await api.updateProjectAgents(project.id, {
      workerAgent: agent,
      plannerAgent: project.plannerAgent,
    });
    await loadProjects();
  }

  // ---- ⌘K commands ----
  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [];
    const ship = (runId: string, kind: ShipKind) =>
      void api.ship(runId, kind).then(
        (r) => showToast(r.message, { tone: "ok", ...(r.url && { url: r.url }) }),
        (e: unknown) => showToast(errorText(e), { tone: "bad" }),
      );
    if (currentRun?.worktree && !currentRun.active) {
      const id = currentRun.id;
      const acts = projects?.find((p) => p.id === currentRun.projectId)?.actions;
      const g = "This run";
      if (acts?.checks.length)
        list.push({
          id: "checks",
          group: g,
          label: "Run checks",
          hint: acts.checks.join(" · "),
          icon: <Icon name="play" size={14} />,
          run: () =>
            void api.runChecks(id).catch((e: unknown) => showToast(errorText(e), { tone: "bad" })),
        });
      if (acts?.dev)
        list.push({
          id: "dev",
          group: g,
          label: "Start the dev server",
          hint: acts.dev.url,
          icon: <Icon name="globe" size={14} />,
          run: () =>
            void api.startDev(id).catch((e: unknown) => showToast(errorText(e), { tone: "bad" })),
        });
      if (currentRun.status !== "done")
        list.push({
          id: "resume",
          group: g,
          label: "Resume",
          icon: <Icon name="resume" size={14} />,
          run: () => void api.resumeRun(id),
        });
      list.push({
        id: "commit",
        group: g,
        label: "Commit",
        icon: <Icon name="check" size={14} />,
        run: () => ship(id, "commit"),
      });
      list.push({
        id: "push",
        group: g,
        label: "Push branch",
        icon: <Icon name="arrowUp" size={14} />,
        run: () => ship(id, "push"),
      });
      if (currentRun.settings.workspace !== "checkout") {
        list.push({
          id: "pr",
          group: g,
          label: "Open a pull request",
          icon: <Icon name="pr" size={14} />,
          run: () => ship(id, "pr"),
        });
        list.push({
          id: "merge",
          group: g,
          label: `Merge into ${currentRun.settings.baseBranch ?? "main"}`,
          icon: <Icon name="branch" size={14} />,
          run: () => ship(id, "merge"),
        });
      }
      for (const op of openers)
        list.push({
          id: `open-${op.id}`,
          group: g,
          label: `Open in ${op.name}`,
          icon: <Icon name="open" size={14} />,
          run: () => void api.openIn(op.id, currentRun.worktree?.path ?? ""),
        });
    }
    projects?.forEach((p, i) =>
      list.push({
        id: `new-${p.id}`,
        group: "Start",
        label: `New task in ${p.name}`,
        icon: <Icon name="edit" size={14} />,
        shortcut: i < 9 ? `⌘${i + 1}` : undefined,
        run: () => openProject(p.id),
      }),
    );
    const go: Array<[Section, string, Parameters<typeof Icon>[0]["name"], string?]> = [
      ["overview", "Overview", "layers", "⌘0"],
      ["traces", "Traces", "trace"],
      ["errors", "Errors", "alert"],
      ["evals", "Evals", "gauge"],
    ];
    for (const [s, label, icon, key] of go)
      list.push({
        id: `go-${s}`,
        group: "Go to",
        label,
        icon: <Icon name={icon} size={14} />,
        shortcut: key,
        run: () => setScreen({ kind: "section", section: s }),
      });
    for (const r of projectRuns.slice(0, 60)) {
      const o = outcomeOf(r);
      list.push({
        id: `run-${r.id}`,
        group: "Runs",
        label: r.title,
        hint: `${projects?.find((p) => p.id === r.projectId)?.name ?? ""} · ${o.line}`,
        icon: <i className={`dot ${o.tone}`} />,
        run: () => showRun(r.id),
      });
    }
    if (project)
      list.push({
        id: "actions",
        group: "Settings",
        label: `Edit actions for ${project.name}`,
        hint: "Setup, checks, dev server",
        icon: <Icon name="play" size={14} />,
        run: () => setEditingActions(true),
      });
    if (project)
      list.push({
        id: "remove",
        group: "Settings",
        label: `Remove ${project.name}…`,
        icon: <Icon name="trash" size={14} />,
        run: () => setRemoving(project.id),
      });
    if (project)
      list.push({
        id: "remove",
        group: "Settings",
        label: `Remove ${project.name}…`,
        icon: <Icon name="trash" size={14} />,
        run: () => setRemoving(project.id),
      });
    list.push({
      id: "add",
      group: "Settings",
      label: "Add a project",
      icon: <Icon name="plus" size={14} />,
      run: () => setAdding(true),
    });
    list.push({
      id: "theme",
      group: "Settings",
      label: resolved === "dark" ? "Switch to light" : "Switch to dark",
      icon: <Icon name={resolved === "dark" ? "sun" : "moon"} size={14} />,
      shortcut: "⌘⇧L",
      run: toggleTheme,
    });
    list.push({
      id: "pin",
      group: "Settings",
      label: pinned ? "Hide the sidebar" : "Keep the sidebar open",
      icon: <Icon name="sidebar" size={14} />,
      shortcut: "⌘B",
      run: togglePin,
    });
    return list;
    // showRun reads only stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    api,
    currentRun,
    projects,
    project,
    projectRuns,
    openers,
    resolved,
    pinned,
    toggleTheme,
    togglePin,
    openProject,
  ]);

  // ---- Render ----
  const pageLabel =
    screen.kind === "section"
      ? { overview: "Overview", traces: "Traces", errors: "Errors", evals: "Evals" }[screen.section]
      : screen.kind === "run"
        ? (currentRun?.title ?? "Run")
        : "New task";

  const sidebar =
    projects && projects.length > 0 ? (
      <Sidebar
        runs={projectRuns}
        projects={projects}
        agents={agents}
        errorCount={errorCount}
        section={screen.kind === "section" ? screen.section : undefined}
        openRunId={screen.kind === "run" ? screen.runId : undefined}
        currentProjectId={projectId}
        pinned={pinned}
        onTogglePin={togglePin}
        onSection={(s) => setScreen({ kind: "section", section: s })}
        onOpenRun={(id) => showRun(id)}
        onOpenProject={openProject}
        onNewTask={(id) => (id ? openProject(id) : setScreen({ kind: "home" }))}
        onAddProject={() => setAdding(true)}
        onProjectMenu={(id) =>
          void api.projectMenu(id).then((choice) => {
            const p = projects.find((x) => x.id === id);
            if (!p || !choice) return;
            if (choice === "reveal") void api.revealInFinder(p.path);
            if (choice === "remove") setRemoving(id);
            if (choice === "new") openProject(id);
            if (choice === "actions") {
              openProject(id);
              setEditingActions(true);
            }
          })
        }
      />
    ) : null;

  return (
    <div className="app">
      <header className="titlebar">
        <span className="tb-divider" aria-hidden="true" />
        <div className="brand">
          <Logo size={18} /> helloagents
        </div>
        {project && projects ? (
          <nav className="tb-crumb" aria-label="Location">
            <Menu
              className="crumb-btn"
              width={260}
              trigger={
                <>
                  {project.name}{" "}
                  <span className="caret">
                    <Icon name="chevronDown" size={14} />
                  </span>
                </>
              }
              items={[
                { header: "Projects" },
                ...projects.map((p, i) => ({
                  id: p.id,
                  label: p.name,
                  checked: p.id === project.id,
                  right: i < 9 ? `⌘${i + 1}` : undefined,
                  onSelect: () => openProject(p.id),
                })),
                {
                  id: "add",
                  label: "Add a project…",
                  icon: <Icon name="plus" size={13} />,
                  onSelect: () => setAdding(true),
                },
              ]}
            />
            <span className="crumb-sep">/</span>
            <span className="crumb-page">{pageLabel}</span>
          </nav>
        ) : null}
        <span className="grow" />
        {projects?.length ? (
          <button className="tb-search" onClick={() => setPalette(true)}>
            <Icon name="search" size={13} /> Search or run a command <span className="kbd">⌘K</span>
          </button>
        ) : null}
        <button
          className="tmode"
          onClick={toggleTheme}
          title="Light or dark (⌘⇧L)"
          aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"}`}
        >
          <span className={resolved === "light" ? "on" : ""}>
            <Icon name="sun" size={13} />
          </span>
          <span className={resolved === "dark" ? "on" : ""}>
            <Icon name="moon" size={13} />
          </span>
        </button>
      </header>

      <div className="body">
        {sidebar ? (
          <>
            {/* The space eases open and shut while the panel slides, so nothing jumps. */}
            <div className={`sb-space ${pinned ? "" : "closed"}`} aria-hidden="true" />
            {!pinned ? (
              <div className="hot-edge" onMouseEnter={openPeek} aria-hidden="true" />
            ) : null}
            <div
              className={`sb-panel ${pinned ? "" : peek ? "floating" : "hidden"}`}
              onMouseEnter={pinned ? undefined : openPeek}
              onMouseLeave={pinned ? undefined : closePeekSoon}
            >
              {sidebar}
            </div>
          </>
        ) : null}

        <main className="main">
          {projects && projects.length === 0 ? (
            <Welcome agents={agents} info={info} onAdd={() => setAdding(true)} />
          ) : screen.kind === "section" && projects ? (
            screen.section === "overview" ? (
              <Overview
                projects={projects}
                runs={projectRuns}
                onOpenRun={(id) => showRun(id)}
                onNewTask={openProject}
                onAddProject={() => setAdding(true)}
              />
            ) : screen.section === "traces" ? (
              <TracesPage projects={projects} />
            ) : screen.section === "errors" ? (
              <ErrorsPage projects={projects} onOpenTrace={(id) => showRun(id, "trace")} />
            ) : (
              <EvalsPage />
            )
          ) : screen.kind === "run" && project ? (
            <RunScreen
              key={screen.runId}
              runId={screen.runId}
              project={project}
              initialTab={screen.tab}
              openers={openers}
              onBack={() => setScreen({ kind: "home" })}
              onOpenRun={(id) => showRun(id)}
            />
          ) : project ? (
            <NewTask
              key={project.id}
              project={project}
              info={projectInfo}
              options={options}
              onStarted={(id) => showRun(id)}
              onAgentChange={(a) => void changeAgent(a)}
              onEditActions={() => setEditingActions(true)}
            />
          ) : null}
        </main>
      </div>

      {palette ? <Palette commands={commands} onClose={() => setPalette(false)} /> : null}
      {editingActions && project ? (
        <ActionsDialog
          project={project}
          actions={
            projectInfo?.actions ??
            project.actions ?? { setup: null, checks: [], dev: null, sendBackFailures: true }
          }
          onClose={() => setEditingActions(false)}
          onSaved={(a) => {
            setEditingActions(false);
            setProjectInfo((pi) => (pi ? { ...pi, actions: a } : pi));
            void loadProjects();
            showToast("Actions saved", { tone: "ok" });
          }}
        />
      ) : null}
      {adding ? (
        <AddProject
          options={options}
          onClose={() => setAdding(false)}
          onAdded={(added) => {
            setAdding(false);
            void loadProjects().then(() => {
              if (added[0]) openProject(added[0].id);
            });
          }}
        />
      ) : null}
      {removing && projects?.some((p) => p.id === removing) ? (
        <RemoveProject
          project={projects.find((p) => p.id === removing) as ProjectRecord}
          runs={projectRuns.filter((r) => r.projectId === removing)}
          errorCount={projectErrors[removing] ?? 0}
          onCancel={() => setRemoving(undefined)}
          onRemoved={() => {
            const name = projects.find((p) => p.id === removing)?.name ?? "project";
            setRemoving(undefined);
            if (screen.kind === "run" && currentRun?.projectId === removing)
              setScreen({ kind: "home" });
            void loadProjects().then(() => loadRuns());
            showToast(`Removed ${name}`, { tone: "ok" });
          }}
        />
      ) : null}
      <Toasts />
    </div>
  );
}
