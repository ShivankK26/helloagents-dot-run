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
import { NewTask } from "./components/NewTask";
import { Overview } from "./components/Overview";
import { Palette, type Command } from "./components/Palette";
import { RemoveProject } from "./components/RemoveProject";
import { RunScreen, type RunTab } from "./components/RunScreen";
import { Sidebar, type Section } from "./components/Sidebar";
import { TerminalDrawer } from "./components/TerminalDrawer";
import { Toasts } from "./components/Toasts";
import { TracesPage } from "./components/TracesPage";
import { Welcome } from "./components/Welcome";
import { Logo } from "./Logo";
import { outcomeOf } from "./outcome";
import { closeTab, loadTabs, newTab, saveTabs, type Screen, type Tab, type Tabs } from "./tabs";
import { applyTheme, savedTheme, watchSystemTheme } from "./theme";
import { errorText, showToast } from "./toast";

// ⌘-click opens in a new tab: remember whether the click being handled had ⌘ held.
let lastClick = { meta: false, at: 0 };
window.addEventListener(
  "click",
  (e) => {
    lastClick = { meta: e.metaKey, at: e.timeStamp };
  },
  true,
);
const wantsNewTab = () => lastClick.meta && performance.now() - lastClick.at < 100;

const PIN_KEY = "helloagents.sidebarPinned";
const TERM_KEY = "helloagents.terminal";
const readTerm = (): { open: boolean; height: number } => {
  try {
    const saved = JSON.parse(localStorage.getItem(TERM_KEY) ?? "null") as {
      open?: boolean;
      height?: number;
    } | null;
    return { open: Boolean(saved?.open), height: saved?.height ?? 280 };
  } catch {
    return { open: false, height: 280 };
  }
};
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
  const [projectInfo, setProjectInfo] = useState<ProjectInfo>();
  // Open chats are tabs in the title bar; the current one decides what the window shows.
  const [tabState, setTabState] = useState<Tabs>(loadTabs);
  useEffect(() => saveTabs(tabState), [tabState]);
  const activeTab =
    tabState.tabs.find((t) => t.id === tabState.active) ?? (tabState.tabs[0] as Tab);
  const screen = activeTab.screen;
  const projectId = activeTab.projectId;
  const setScreen = useCallback(
    (next: Screen) =>
      setTabState((s) => ({
        ...s,
        tabs: s.tabs.map((t) => (t.id === s.active ? { ...t, screen: next } : t)),
      })),
    [],
  );
  const [pinned, setPinned] = useState(readPinned);
  const [term, setTerm] = useState(readTerm);
  useEffect(() => {
    try {
      localStorage.setItem(TERM_KEY, JSON.stringify(term));
    } catch {
      // not remembered
    }
  }, [term]);
  const toggleTerm = useCallback(() => setTerm((t) => ({ ...t, open: !t.open })), []);
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
        // Tabs on a project that's gone (or none yet) move to the first project.
        setTabState((s) => {
          const fix = (t: Tab) =>
            t.projectId && list.some((p) => p.id === t.projectId)
              ? t
              : { ...t, projectId: list[0]?.id };
          return s.tabs.every((t) => fix(t) === t) ? s : { ...s, tabs: s.tabs.map(fix) };
        });
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

  /** Shows a screen: in its own tab if it's open, a new tab on ⌘-click, else in this tab. */
  const go = useCallback((next: Screen, pid?: string, fresh = false) => {
    setTabState((s) => {
      const open =
        next.kind === "run"
          ? s.tabs.find((t) => t.screen.kind === "run" && t.screen.runId === next.runId)
          : undefined;
      if (open)
        return {
          tabs: s.tabs.map((t) => (t.id === open.id ? { ...t, screen: next } : t)),
          active: open.id,
        };
      const at = Math.max(
        0,
        s.tabs.findIndex((t) => t.id === s.active),
      );
      const current = s.tabs[at] as Tab;
      const tab = { ...newTab(next, pid ?? current.projectId), ...(!fresh && { id: current.id }) };
      if (!fresh) return { ...s, tabs: s.tabs.map((t) => (t.id === current.id ? tab : t)) };
      return { tabs: [...s.tabs.slice(0, at + 1), tab, ...s.tabs.slice(at + 1)], active: tab.id };
    });
  }, []);
  const openProject = useCallback(
    (id: string, fresh = wantsNewTab()) => go({ kind: "home" }, id, fresh),
    [go],
  );
  function showRun(runId: string, tab: RunTab = "activity") {
    const fresh = wantsNewTab();
    const known = runs.find((r) => r.id === runId)?.projectId;
    if (known) return go({ kind: "run", runId, tab }, known, fresh);
    void api
      .getRun(runId)
      .then((run) => go({ kind: "run", runId, tab }, run?.projectId ?? undefined, fresh));
  }
  const openTab = useCallback(() => go({ kind: "home" }, undefined, true), [go]);
  const shutTab = useCallback((id: string) => {
    setTabState((s) => {
      // Closing the last New task tab closes the window, like a browser.
      const only = s.tabs.length === 1 ? s.tabs[0] : undefined;
      if (only?.id === id && only.screen.kind === "home") {
        window.close();
        return s;
      }
      return closeTab(s, id);
    });
  }, []);
  const cycleTab = useCallback((step: number) => {
    setTabState((s) => {
      const at = s.tabs.findIndex((t) => t.id === s.active);
      const n = s.tabs.length;
      return { ...s, active: (s.tabs[(at + step + n) % n] as Tab).id };
    });
  }, []);
  useEffect(() => api.onCloseTab(() => shutTab(tabState.active)), [api, shutTab, tabState.active]);
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
      if (e.ctrlKey && !e.metaKey && (e.key === "`" || e.code === "Backquote")) {
        e.preventDefault();
        toggleTerm();
        return;
      }
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        cycleTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (
        e.metaKey &&
        e.shiftKey &&
        (e.key === "[" || e.key === "]" || e.key === "{" || e.key === "}")
      ) {
        e.preventDefault();
        cycleTab(e.key === "[" || e.key === "{" ? -1 : 1);
        return;
      }
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
      } else if (k === "t" && !e.shiftKey) {
        e.preventDefault();
        openTab();
      } else if (/^[1-9]$/.test(k) && projects) {
        const p = projects[Number(k) - 1];
        if (p) {
          e.preventDefault();
          openProject(p.id, false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePin, toggleTheme, projects, openProject, setScreen, openTab, cycleTab, toggleTerm]);

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
  // The terminal opens where the current tab's work is: the run's folder, else the project.
  const termCwd = currentRun?.worktree?.path ?? project?.path;
  const termLabel = currentRun?.worktree?.path
    ? `${project?.name ?? ""} · this run's folder`
    : (project?.name ?? "");
  const projectName = (id?: string) => projects?.find((p) => p.id === id)?.name;
  const tabLabel = (t: Tab): { title: string; sub?: string; tone?: string } => {
    const sc = t.screen;
    if (sc.kind === "section")
      return {
        title: { overview: "Overview", traces: "Traces", errors: "Errors", evals: "Evals" }[
          sc.section
        ],
      };
    if (sc.kind === "home") return { title: "New task", sub: projectName(t.projectId) };
    const run = runs.find((r) => r.id === sc.runId);
    return {
      title: run?.title ?? "Run",
      sub: projectName(run?.projectId ?? t.projectId),
      tone: run ? outcomeOf(run).tone : undefined,
    };
  };

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
        <div className="brand" title="helloagents">
          <Logo size={18} />
        </div>
        {projects?.length ? (
          <nav className="ctabs" aria-label="Open tabs">
            {tabState.tabs.map((t) => {
              const label = tabLabel(t);
              const on = t.id === activeTab.id;
              return (
                <div
                  key={t.id}
                  className={`ctab ${on ? "on" : ""}`}
                  role="tab"
                  aria-selected={on}
                  tabIndex={0}
                  title={label.sub ? `${label.title} · ${label.sub}` : label.title}
                  onClick={() => setTabState((st) => ({ ...st, active: t.id }))}
                  onAuxClick={(e) => e.button === 1 && shutTab(t.id)}
                  onKeyDown={(e) =>
                    (e.key === "Enter" || e.key === " ") &&
                    setTabState((st) => ({ ...st, active: t.id }))
                  }
                >
                  {label.tone ? <i className={`dot ${label.tone}`} /> : null}
                  <span className="ctab-text">
                    <span className="ctab-title">{label.title}</span>
                    {label.sub ? <span className="ctab-sub">{label.sub}</span> : null}
                  </span>
                  <button
                    className="ctab-x"
                    aria-label={`Close ${label.title}`}
                    title="Close (⌘W)"
                    onClick={(e) => {
                      e.stopPropagation();
                      shutTab(t.id);
                    }}
                  >
                    <Icon name="close" size={11} />
                  </button>
                </div>
              );
            })}
            <button
              className="ctab-new"
              onClick={openTab}
              title="New tab (⌘T)"
              aria-label="New tab"
            >
              <Icon name="plus" size={14} />
            </button>
          </nav>
        ) : null}
        <span className="grow" />
        {project ? (
          <button
            className={`tb-search icon ${term.open ? "on" : ""}`}
            onClick={toggleTerm}
            title="Terminal (⌃`)"
            aria-label={term.open ? "Hide the terminal" : "Open a terminal"}
          >
            <Icon name="term" size={15} />
          </button>
        ) : null}
        {projects?.length ? (
          <button
            className="tb-search icon"
            onClick={() => setPalette(true)}
            title="Search or run a command (⌘K)"
            aria-label="Search or run a command"
          >
            <Icon name="search" size={14} />
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

        <div className="main-col">
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
          {term.open && project ? (
            <TerminalDrawer
              cwd={termCwd ?? project.path}
              fallback={project.path}
              label={termLabel}
              dark={resolved === "dark"}
              height={term.height}
              onHeight={(height) => setTerm((t) => ({ ...t, height }))}
              onClose={() => setTerm((t) => ({ ...t, open: false }))}
            />
          ) : null}
        </div>
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
            // Its tabs go too.
            setTabState((s) =>
              s.tabs
                .filter((t) => t.projectId === removing)
                .reduce((acc, t) => closeTab(acc, t.id), s),
            );
            void loadProjects().then(() => loadRuns());
            showToast(`Removed ${name}`, { tone: "ok" });
          }}
        />
      ) : null}
      <Toasts />
    </div>
  );
}
