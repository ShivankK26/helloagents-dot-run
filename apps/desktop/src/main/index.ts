import { writeFile } from "node:fs/promises";
import path from "node:path";
import { ENGINE_VERSION, detectClaudeCode, loadShellPath } from "@helloagents/engine";
import { app, BrowserWindow, ipcMain, nativeTheme, shell } from "electron";
import { IPC, type AppInfo } from "../shared/api";

const isMac = process.platform === "darwin";

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: "helloagents",
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#0f1012" : "#f3f4f6",
    ...(isMac && { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 18 } }),
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      // The window shows text written by AI agents. Keep it away from Node.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  // Links open in the user's browser, never inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault();
  });

  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(path.join(__dirname, "../renderer/index.html"));

  return win;
}

/** For development checks: HELLOAGENTS_CAPTURE=out.png saves a screenshot of the window and quits. */
function captureAndQuit(win: BrowserWindow, file: string): void {
  win.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      const image = await win.webContents.capturePage();
      await writeFile(file, image.toPNG());
      app.quit();
    }, 2500);
  });
}

app.whenReady().then(async () => {
  // Finder-launched apps get a minimal PATH; use the login shell's instead.
  const shellPath = await loadShellPath();
  if (shellPath) process.env.PATH = shellPath;

  ipcMain.handle(IPC.getInfo, async (): Promise<AppInfo> => ({
    appVersion: app.getVersion(),
    engineVersion: ENGINE_VERSION,
    electron: process.versions.electron,
    platform: process.platform,
    claudeCode: await detectClaudeCode(),
  }));

  const win = createWindow();
  if (process.env.HELLOAGENTS_CAPTURE) captureAndQuit(win, process.env.HELLOAGENTS_CAPTURE);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
