import { useCallback, useEffect, useState } from "react";
import type { AgentId, AgentProvider, AppInfo, ProjectRecord } from "../../shared/api";
import { agentOptions } from "./agents";
import { AddProject } from "./components/AddProject";
import { ErrorsPage } from "./components/ErrorsPage";
import { EvalsPage } from "./components/EvalsPage";
import { ProjectHome } from "./components/ProjectHome";
import { RunScreen, type RunTab } from "./components/RunScreen";
import { Sidebar, type View } from "./components/Sidebar";
import { TracesPage } from "./components/TracesPage";
import { Welcome } from "./components/Welcome";
import { Logo } from "./Logo";

const PINNED_KEY = "helloagents.sidebarPinned";

function readPinned(): boolean {
  try {
    return localStorage.getItem(PINNED_KEY) === "1";
  } catch {
    return false;
  }
}

export function App() {
  const api = window.helloagents;
  const [info, setInfo] = useState<AppInfo>();
  const [agents, setAgents] = useState<AgentProvider[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>();
  const [selected, setSelected] = useState<string>();
  const [openRun, setOpenRun] = useState<{ id: string; tab: RunTab }>();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<View>("runs");
  const [errorCount, setErrorCount] = useState(0);
  const [pinned, setPinned] = useState(readPinned);

  const togglePin = useCallback(
    () =>
      setPinned((p) => {
        try {
          localStorage.setItem(PINNED_KEY, p ? "0" : "1");
        } catch {
          // Not remembered; it still toggles for this session.
        }
        return !p;
      }),
    [],
  );

  const loadProjects = useCallback(
    () =>
      api.listProjects().then((list) => {
        setProjects(list);
        setSelected((s) => s ?? list[0]?.id);
      }),
    [api],
  );

  useEffect(() => {
    void api.getInfo().then(setInfo);
    void api.detectAgents().then(setAgents);
    void loadProjects();
  }, [api, loadProjects]);

  // ⌘B / Ctrl+B keeps the sidebar open or lets it close again.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
        e.preventDefault();
        togglePin();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePin]);

  useEffect(() => {
    const count = () => void api.listErrors().then((list) => setErrorCount(list.length));
    count();
    return api.onRunChanged(count);
  }, [api]);

  const options = agentOptions(agents, info);
  const project = projects?.find((p) => p.id === selected);

  /** Opens a run's own screen, from anywhere in the app. */
  const showRun = useCallback(
    (runId: string, tab: RunTab = "activity") =>
      void api.getRun(runId).then((run) => {
        if (run?.projectId) setSelected(run.projectId);
        setOpenRun({ id: runId, tab });
        setView("runs");
      }),
    [api],
  );

  async function changeAgent(agent: AgentId) {
    if (!project) return;
    await api.updateProjectAgents(project.id, {
      workerAgent: agent,
      plannerAgent: project.plannerAgent,
    });
    await loadProjects();
  }

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <Logo size={18} /> helloagents
        </div>
      </header>
      <div className="body">
        {projects && projects.length > 0 ? (
          <>
            <Sidebar
              pinned={pinned}
              onTogglePin={togglePin}
              view={view}
              onView={(v) => {
                setView(v);
                if (v === "runs") setOpenRun(undefined);
              }}
              errorCount={errorCount}
              projects={projects}
              selected={selected}
              agents={agents}
              onSelect={(id) => {
                setSelected(id);
                setOpenRun(undefined);
                setView("runs");
              }}
              onAdd={() => setAdding(true)}
            />
            <main className="main">
              {view === "runs" && project ? (
                openRun ? (
                  <RunScreen
                    key={openRun.id}
                    runId={openRun.id}
                    project={project}
                    initialTab={openRun.tab}
                    onBack={() => setOpenRun(undefined)}
                  />
                ) : (
                  <ProjectHome
                    key={project.id}
                    project={project}
                    options={options}
                    onOpenRun={(id) => setOpenRun({ id, tab: "activity" })}
                    onAgentChange={(a) => void changeAgent(a)}
                  />
                )
              ) : null}
              {view === "traces" ? <TracesPage projects={projects} /> : null}
              {view === "errors" ? (
                <ErrorsPage projects={projects} onOpenTrace={(runId) => showRun(runId, "trace")} />
              ) : null}
              {view === "evals" ? <EvalsPage /> : null}
            </main>
          </>
        ) : projects ? (
          <main className="main">
            <Welcome agents={agents} info={info} onAdd={() => setAdding(true)} />
          </main>
        ) : null}
      </div>
      {adding ? (
        <AddProject
          options={options}
          onClose={() => setAdding(false)}
          onAdded={(added) => {
            setAdding(false);
            void loadProjects().then(() => {
              if (added[0]) setSelected(added[0].id);
              setOpenRun(undefined);
              setView("runs");
            });
          }}
        />
      ) : null}
    </div>
  );
}
