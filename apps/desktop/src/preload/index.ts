import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC, type HelloagentsApi } from "../shared/api";

// The only bridge between the window and the machine. Add functions here
// deliberately; never expose ipcRenderer itself.
const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

const api: HelloagentsApi = {
  getInfo: () => invoke(IPC.getInfo),
  detectAgents: () => invoke(IPC.detectAgents),
  chooseFolder: () => invoke(IPC.chooseFolder),
  inspectFolder: (path) => invoke(IPC.inspectFolder, path),
  cloneRepo: (url) => invoke(IPC.cloneRepo, url),
  listProjects: () => invoke(IPC.listProjects),
  addProject: (input) => invoke(IPC.addProject, input),
  updateProjectAgents: (id, agents) => invoke(IPC.updateProjectAgents, id, agents),
  removeProject: (id) => invoke(IPC.removeProject, id),
  listRuns: (projectId) => invoke(IPC.listRuns, projectId),
  followUp: (runId, message) => invoke(IPC.followUp, runId, message),
  projectInfo: (projectId) => invoke(IPC.projectInfo, projectId),
  setProjectActions: (projectId, actions) => invoke(IPC.setProjectActions, projectId, actions),
  detectActions: (projectId) => invoke(IPC.detectActions, projectId),
  resumeRun: (runId) => invoke(IPC.resumeRun, runId),
  runChecks: (runId) => invoke(IPC.runChecks, runId),
  ship: (runId, kind) => invoke(IPC.ship, runId, kind),
  startDev: (runId) => invoke(IPC.startDev, runId),
  stopDev: (runId) => invoke(IPC.stopDev, runId),
  listOpeners: () => invoke(IPC.listOpeners),
  openIn: (openerId, path) => invoke(IPC.openIn, openerId, path),
  setTheme: (mode) => invoke(IPC.setTheme, mode),
  listAllRuns: (limit) => invoke(IPC.listAllRuns, limit),
  listErrors: (limit) => invoke(IPC.listErrors, limit),
  getRun: (runId) => invoke(IPC.getRun, runId),
  startRun: (projectId, task, settings) => invoke(IPC.startRun, projectId, task, settings),
  cancelRun: (runId) => invoke(IPC.cancelRun, runId),
  discardRun: (runId) => invoke(IPC.discardRun, runId),
  runEvents: (runId, afterSeq) => invoke(IPC.runEvents, runId, afterSeq),
  runDiff: (runId) => invoke(IPC.runDiff, runId),
  revealInFinder: (path) => invoke(IPC.revealInFinder, path),
  openExternal: (url) => invoke(IPC.openExternal, url),
  onRunChanged: (listener) => {
    const handler = (_event: IpcRendererEvent, runId: string) => listener(runId);
    ipcRenderer.on(IPC.runChanged, handler);
    return () => ipcRenderer.removeListener(IPC.runChanged, handler);
  },
  onOpenRun: (listener) => {
    const handler = (_event: IpcRendererEvent, runId: string) => listener(runId);
    ipcRenderer.on(IPC.openRun, handler);
    return () => ipcRenderer.removeListener(IPC.openRun, handler);
  },
};

contextBridge.exposeInMainWorld("helloagents", api);
