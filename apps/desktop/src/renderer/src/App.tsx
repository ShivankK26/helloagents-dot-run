import { useCallback, useEffect, useState } from "react";
import type { AgentProvider, AppInfo, ProjectRecord } from "../../shared/api";
import { agentOptions } from "./agents";
import { AddProject } from "./components/AddProject";
import { ErrorsPage } from "./components/ErrorsPage";
import { EvalsPage } from "./components/EvalsPage";
import { ProjectView } from "./components/ProjectView";
import { Sidebar, type View } from "./components/Sidebar";
import { TracesPage } from "./components/TracesPage";
import { Welcome } from "./components/Welcome";
import { Logo } from "./Logo";

export function App() {
  const api = window.helloagents;
  const [info, setInfo] = useState<AppInfo>();
  const [agents, setAgents] = useState<AgentProvider[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>();
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);
  const [view, setView] = useState<View>("runs");
  const [traceRun, setTraceRun] = useState<string>();
  const [errorCount, setErrorCount] = useState(0);

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

  useEffect(() => {
    const count = () => void api.listErrors().then((list) => setErrorCount(list.length));
    count();
    return api.onRunChanged(count);
  }, [api]);

  const options = agentOptions(agents, info);
  const project = projects?.find((p) => p.id === selected);

  return (
    <div className="app">
      <header className="titlebar">
        <div className="brand">
          <Logo size={20} /> helloagents
        </div>
      </header>
      <div className="body">
        {projects && projects.length > 0 ? (
          <>
            <Sidebar
              view={view}
              onView={(v) => {
                setTraceRun(undefined);
                setView(v);
              }}
              errorCount={errorCount}
              projects={projects}
              selected={selected}
              agents={agents}
              onSelect={(id) => {
                setSelected(id);
                setView("runs");
              }}
              onAdd={() => setAdding(true)}
            />
            <main className="main">
              {view === "runs" && project ? (
                <ProjectView key={project.id} project={project} options={options} />
              ) : null}
              {view === "traces" ? (
                <TracesPage key={traceRun ?? "all"} projects={projects} initialRunId={traceRun} />
              ) : null}
              {view === "errors" ? (
                <ErrorsPage
                  projects={projects}
                  onOpenTrace={(runId) => {
                    setTraceRun(runId);
                    setView("traces");
                  }}
                />
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
              setView("runs");
            });
          }}
        />
      ) : null}
    </div>
  );
}
