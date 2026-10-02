import { contextBridge, ipcRenderer } from "electron";
import { IPC, type HelloagentsApi } from "../shared/api";

// The only bridge between the window and the machine. Add functions here
// deliberately; never expose ipcRenderer itself.
const api: HelloagentsApi = {
  getInfo: () => ipcRenderer.invoke(IPC.getInfo),
};

contextBridge.exposeInMainWorld("helloagents", api);
