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
  projectMenu: (id) => invoke(IPC.projectMenu, id),
  listRuns: (projectId) => invoke(IPC.listRuns, projectId),
  followUp: (runId, message, attachments) => invoke(IPC.followUp, runId, message, attachments),
  listSlashCommands: (projectId) => invoke(IPC.listSlashCommands, projectId),
  saveAttachment: (name, bytes) => invoke(IPC.saveAttachment, name, bytes),
  projectInfo: (projectId) => invoke(IPC.projectInfo, projectId),
  setProjectActions: (projectId, actions) => invoke(IPC.setProjectActions, projectId, actions),
  detectActions: (projectId) => invoke(IPC.detectActions, projectId),
  resumeRun: (runId) => invoke(IPC.resumeRun, runId),
  runChecks: (runId) => invoke(IPC.runChecks, runId),
  ship: (runId, kind) => invoke(IPC.ship, runId, kind),
  remoteInfo: (runId) => invoke(IPC.remoteInfo, runId),
  connectRemote: (runId, repo) => invoke(IPC.connectRemote, runId, repo),
  readImage: (path) => invoke(IPC.readImage, path),
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
  answerApproval: (runId, requestId, answer) =>
    invoke(IPC.answerApproval, runId, requestId, answer),
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
  onCloseTab: (listener) => {
    const handler = () => listener();
    ipcRenderer.on(IPC.closeTab, handler);
    return () => ipcRenderer.removeListener(IPC.closeTab, handler);
  },
  termStart: (cwds, cols, rows) => invoke(IPC.termStart, cwds, cols, rows),
  termWrite: (id, data) => ipcRenderer.send(IPC.termWrite, id, data),
  termResize: (id, cols, rows) => ipcRenderer.send(IPC.termResize, id, cols, rows),
  termKill: (id) => ipcRenderer.send(IPC.termKill, id),
  onTermData: (listener) => {
    const handler = (_event: IpcRendererEvent, id: string, data: string) => listener(id, data);
    ipcRenderer.on(IPC.termData, handler);
    return () => ipcRenderer.removeListener(IPC.termData, handler);
  },
  onTermExit: (listener) => {
    const handler = (_event: IpcRendererEvent, id: string, code: number) => listener(id, code);
    ipcRenderer.on(IPC.termExit, handler);
    return () => ipcRenderer.removeListener(IPC.termExit, handler);
  },
};

contextBridge.exposeInMainWorld("helloagents", api);
