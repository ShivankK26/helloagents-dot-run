import { useCallback, useEffect, useState } from "react";
import type { AgentProvider, AppInfo, ProjectRecord } from "../../shared/api";
import { agentOptions } from "./agents";
import { AddProject } from "./components/AddProject";
import { ProjectView } from "./components/ProjectView";
import { Sidebar } from "./components/Sidebar";
import { Welcome } from "./components/Welcome";
import { Logo } from "./Logo";

export function App() {
  const api = window.helloagents;
  const [info, setInfo] = useState<AppInfo>();
  const [agents, setAgents] = useState<AgentProvider[]>([]);
  const [projects, setProjects] = useState<ProjectRecord[]>();
  const [selected, setSelected] = useState<string>();
  const [adding, setAdding] = useState(false);

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
              projects={projects}
              selected={selected}
              agents={agents}
              onSelect={setSelected}
              onAdd={() => setAdding(true)}
            />
            <main className="main">
              {project ? (
                <ProjectView key={project.id} project={project} options={options} />
              ) : null}
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
            void loadProjects().then(() => added[0] && setSelected(added[0].id));
          }}
        />
      ) : null}
    </div>
  );
}
