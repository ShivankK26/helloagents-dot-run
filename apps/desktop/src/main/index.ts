import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  AnthropicModel,
  cloneRepo,
  detectAgents,
  detectClaudeCode,
  ENGINE_VERSION,
  findChildRepos,
  git,
  isGitRepo,
  loadShellPath,
  RunManager,
  TraceStore,
  type AgentId,
} from "@helloagents/engine";
import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from "electron";
import { IPC, type AppInfo, type FolderInfo, type RunListItem } from "../shared/api";

const isMac = process.platform === "darwin";
let win: BrowserWindow | undefined;

function createWindow(): BrowserWindow {
  const w = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    title: "helloagents",
    ...(!app.isPackaged && { icon: APP_ICON }),
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
  w.once("ready-to-show", () => w.show());
  // Links open in the user's browser, never inside the app window.
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (event, url) => {
    if (url !== w.webContents.getURL()) event.preventDefault();
  });
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (devUrl) void w.loadURL(devUrl);
  else void w.loadFile(path.join(__dirname, "../renderer/index.html"));
  return w;
}

// The packaged app gets its icon from the bundle; dev and preview builds need it set here.
const APP_ICON = path.join(__dirname, "../../resources/icon.png");

/**
 * For development checks: HELLOAGENTS_CAPTURE=out.png saves a screenshot and
 * quits. HELLOAGENTS_CAPTURE_SCRIPT runs first (e.g. to click to a screen).
 */
function captureAndQuit(w: BrowserWindow, file: string): void {
  // A window in the background stops painting, so later clicks never reach the capture.
  w.webContents.setBackgroundThrottling(false);
  w.webContents.once("did-finish-load", () => {
    setTimeout(async () => {
      const script = process.env.HELLOAGENTS_CAPTURE_SCRIPT;
      if (script) {
        await w.webContents
          .executeJavaScript(script)
          .catch((e: unknown) => console.error("capture script failed", e));
        await new Promise((r) =>
          setTimeout(r, Number(process.env.HELLOAGENTS_CAPTURE_WAIT ?? 1500)),
        );
      }
      const image = await w.webContents.capturePage();
      await writeFile(file, image.toPNG());
      app.quit();
    }, 1500);
  });
}

app.whenReady().then(async () => {
  if (isMac && !app.isPackaged) app.dock?.setIcon(APP_ICON);
  // Finder-launched apps get a minimal PATH; use the login shell's instead.
  const shellPath = await loadShellPath();
  if (shellPath) process.env.PATH = shellPath;

  // HELLOAGENTS_DATA_DIR keeps demos and tests away from real data.
  const dataDir = process.env.HELLOAGENTS_DATA_DIR ?? app.getPath("userData");
  const store = new TraceStore(path.join(dataDir, "helloagents.db"));
  const manager = new RunManager({
    store,
    worktreesRoot: path.join(dataDir, "worktrees"),
    onChange: (runId) => win?.webContents.send(IPC.runChanged, runId),
    // HELLOAGENTS_CLAUDE_PATH points at a fake CLI for free demos.
    ...(process.env.HELLOAGENTS_CLAUDE_PATH && { claudePath: process.env.HELLOAGENTS_CLAUDE_PATH }),
    createModel: () => {
      if (!process.env.ANTHROPIC_API_KEY) {
        throw new Error(
          "The built-in agent needs ANTHROPIC_API_KEY. Set it, or switch this project to Claude Code.",
        );
      }
      return new AnthropicModel();
    },
  });
  const listItem = (run: NonNullable<ReturnType<TraceStore["getRun"]>>): RunListItem => ({
    ...run,
    active: manager.isActive(run.id),
  });

  ipcMain.handle(IPC.getInfo, async (): Promise<AppInfo> => ({
    appVersion: app.getVersion(),
    engineVersion: ENGINE_VERSION,
    electron: process.versions.electron,
    platform: process.platform,
    claudeCode: await detectClaudeCode(),
    hasApiKey: Boolean(process.env.ANTHROPIC_API_KEY),
  }));
  ipcMain.handle(IPC.detectAgents, () => detectAgents());
  ipcMain.handle(IPC.chooseFolder, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
      message: "Choose a project folder",
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle(IPC.inspectFolder, async (_e, dir: string): Promise<FolderInfo> => {
    const isRepo = await isGitRepo(dir);
    const hasCommits =
      isRepo &&
      (await git(dir, ["rev-parse", "HEAD"]).then(
        () => true,
        () => false,
      ));
    const childRepos = isRepo
      ? []
      : (await findChildRepos(dir)).map((p) => ({ path: p, name: path.basename(p) }));
    return { path: dir, name: path.basename(dir), isRepo, hasCommits, childRepos };
  });
  ipcMain.handle(IPC.cloneRepo, async (_e, url: string) => {
    const parent = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      message: "Where should the repository go?",
    });
    if (parent.canceled || !parent.filePaths[0]) return null;
    const name =
      url
        .replace(/\.git$/, "")
        .split(/[/:]/)
        .pop() || "repo";
    return cloneRepo(url, path.join(parent.filePaths[0], name));
  });
  ipcMain.handle(IPC.listProjects, () => store.listProjects());
  ipcMain.handle(
    IPC.addProject,
    (_e, input: { path: string; name: string; workerAgent: AgentId; plannerAgent: AgentId }) =>
      store.addProject(input),
  );
  ipcMain.handle(
    IPC.updateProjectAgents,
    (_e, id: string, agents: { workerAgent: AgentId; plannerAgent: AgentId }) =>
      store.updateProjectAgents(id, agents),
  );
  ipcMain.handle(IPC.removeProject, (_e, id: string) => store.removeProject(id));
  ipcMain.handle(IPC.listRuns, (_e, projectId: string) =>
    store.listProjectRuns(projectId).map(listItem),
  );
  ipcMain.handle(IPC.getRun, (_e, runId: string) => {
    const run = store.getRun(runId);
    return run ? listItem(run) : null;
  });
  ipcMain.handle(IPC.startRun, (_e, projectId: string, task: string) =>
    manager.start(projectId, task),
  );
  ipcMain.handle(IPC.cancelRun, (_e, runId: string) => manager.cancel(runId));
  ipcMain.handle(IPC.discardRun, (_e, runId: string) => manager.discard(runId));
  ipcMain.handle(IPC.runEvents, (_e, runId: string, afterSeq: number) =>
    store.events(runId, { afterSeq }),
  );
  ipcMain.handle(IPC.runDiff, (_e, runId: string) => manager.diff(runId));
  ipcMain.handle(IPC.revealInFinder, (_e, p: string) => shell.showItemInFolder(p));

  win = createWindow();
  if (process.env.HELLOAGENTS_CAPTURE) captureAndQuit(win, process.env.HELLOAGENTS_CAPTURE);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow();
  });
  app.on("before-quit", () => store.close());
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
