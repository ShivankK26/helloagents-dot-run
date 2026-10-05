import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
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
  listSlashCommands,
  loadShellPath,
  setUpRepo,
  detectActions,
  digestRun,
  RunManager,
  toErrors,
  TraceStore,
  type AgentId,
  type ProjectActions,
  type RunSettings,
} from "@helloagents/engine";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  shell,
} from "electron";
import {
  IPC,
  type AppInfo,
  type ApprovalAnswer,
  type ApprovalRequest,
  type ErrorListItem,
  type FolderInfo,
  type Opener,
  type ProjectMenuChoice,
  type RunListItem,
  type ShipKind,
  type SlashCommand,
  type ThemeMode,
} from "../shared/api";

/** Apps that can open a project folder, if installed. Finder and Terminal always are. */
const OPENERS: Array<Opener & { app: string; path?: string }> = [
  { id: "zed", name: "Zed", app: "Zed", path: "/Applications/Zed.app" },
  { id: "cursor", name: "Cursor", app: "Cursor", path: "/Applications/Cursor.app" },
  {
    id: "vscode",
    name: "VS Code",
    app: "Visual Studio Code",
    path: "/Applications/Visual Studio Code.app",
  },
  { id: "xcode", name: "Xcode", app: "Xcode", path: "/Applications/Xcode.app" },
  { id: "finder", name: "Finder", app: "Finder" },
  { id: "iterm", name: "iTerm", app: "iTerm", path: "/Applications/iTerm.app" },
  { id: "ghostty", name: "Ghostty", app: "Ghostty", path: "/Applications/Ghostty.app" },
  { id: "terminal", name: "Terminal", app: "Terminal" },
];

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
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#000000" : "#ffffff",
    ...(isMac && { titleBarStyle: "hiddenInset" as const, trafficLightPosition: { x: 16, y: 16 } }),
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

// One copy at a time: a second launch focuses the open window instead of
// starting another app on the same data (which renders blank).
if (!app.requestSingleInstanceLock()) app.quit();
app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(async () => {
  if (isMac && !app.isPackaged) app.dock?.setIcon(APP_ICON);
  // Finder-launched apps get a minimal PATH; use the login shell's instead.
  const shellPath = await loadShellPath();
  if (shellPath) process.env.PATH = shellPath;

  // HELLOAGENTS_DATA_DIR keeps demos and tests away from real data.
  const dataDir = process.env.HELLOAGENTS_DATA_DIR ?? app.getPath("userData");
  const store = new TraceStore(path.join(dataDir, "helloagents.db"));
  store.closeInterruptedRuns();
  const manager = new RunManager({
    store,
    worktreesRoot: path.join(dataDir, "worktrees"),
    onChange: (runId) => {
      win?.webContents.send(IPC.runChanged, runId);
      updateBadge();
    },
    onSettled: (runId) => notifySettled(runId),
    onApproval: (runId, request) => notifyApproval(runId, request.description),
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
    ...(approvalOf(run.id) && { approval: approvalOf(run.id) }),
    devRunning: manager.devRunning(run.id),
    // A folder freed to save space isn't gone: it comes back when the run continues.
    branchGone: Boolean(run.worktree && manager.folderState(run.id) === "gone"),
    digest: digestRun(store.events(run.id)),
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
    async (
      _e,
      input: { path: string; name: string; workerAgent: AgentId; plannerAgent: AgentId },
    ) => {
      // Branches need git. A plain folder (or a repo with no commits) gets it set up
      // locally: git init, a .gitignore that keeps secrets out, and a first commit.
      await setUpRepo(input.path);
      return store.addProject(input);
    },
  );
  ipcMain.handle(
    IPC.updateProjectAgents,
    (_e, id: string, agents: { workerAgent: AgentId; plannerAgent: AgentId }) =>
      store.updateProjectAgents(id, agents),
  );
  ipcMain.handle(IPC.removeProject, (_e, id: string) => manager.removeProject(id));
  ipcMain.handle(
    IPC.projectMenu,
    () =>
      new Promise<ProjectMenuChoice | null>((resolve) => {
        let picked: ProjectMenuChoice | null = null;
        const pick = (choice: ProjectMenuChoice) => () => (picked = choice);
        Menu.buildFromTemplate([
          { label: "Show in Finder", click: pick("reveal") },
          { type: "separator" },
          { label: "Remove…", click: pick("remove") },
        ]).popup({ ...(win && { window: win }), callback: () => resolve(picked) });
      }),
  );
  ipcMain.handle(IPC.listRuns, (_e, projectId: string) =>
    store.listProjectRuns(projectId).map(listItem),
  );
  ipcMain.handle(IPC.listAllRuns, (_e, limit?: number) =>
    store.listRuns(limit ?? 100).map(listItem),
  );
  ipcMain.handle(IPC.listErrors, (_e, limit?: number): ErrorListItem[] =>
    store
      .listRuns(limit ?? 100)
      .flatMap((run) =>
        toErrors(store.events(run.id)).map((err) => ({
          ...err,
          runId: run.id,
          runTitle: run.title,
          projectId: run.projectId,
        })),
      )
      .sort((a, b) => b.at - a.at),
  );
  ipcMain.handle(IPC.getRun, (_e, runId: string) => {
    const run = store.getRun(runId);
    return run ? listItem(run) : null;
  });
  ipcMain.handle(IPC.followUp, (_e, runId: string, message: string, attachments?: string[]) =>
    manager.followUp(runId, message, attachments),
  );
  // Asking Claude Code for its commands takes a couple of seconds, so once per project per launch.
  const slashCommands = new Map<string, Promise<SlashCommand[]>>();
  ipcMain.handle(IPC.listSlashCommands, (_e, projectId: string) => {
    const project = store.getProject(projectId);
    if (!project) return [];
    let list = slashCommands.get(projectId);
    if (!list) {
      list = listSlashCommands(project.path, process.env.HELLOAGENTS_CLAUDE_PATH);
      list.catch(() => slashCommands.delete(projectId));
      slashCommands.set(projectId, list);
    }
    return list;
  });
  const attachmentsDir = path.join(dataDir, "attachments");
  ipcMain.handle(IPC.saveAttachment, async (_e, name: string, bytes: Uint8Array) => {
    const ext = path.extname(name).toLowerCase();
    if (![".png", ".jpg", ".jpeg", ".gif", ".webp"].includes(ext))
      throw new Error("Only images can be attached.");
    if (bytes.byteLength > 10 * 1024 * 1024) throw new Error("Images must be under 10 MB.");
    await mkdir(attachmentsDir, { recursive: true });
    const safe = path
      .basename(name)
      .replace(/[^\w.-]+/g, "-")
      .slice(-60);
    const file = path.join(attachmentsDir, `${randomUUID().slice(0, 8)}-${safe}`);
    await writeFile(file, bytes);
    return file;
  });
  ipcMain.handle(IPC.startRun, (_e, projectId: string, task: string, settings?: RunSettings) =>
    manager.start(projectId, task, settings ?? {}),
  );
  ipcMain.handle(IPC.projectInfo, (_e, projectId: string) => manager.projectInfo(projectId));
  ipcMain.handle(IPC.setProjectActions, (_e, projectId: string, actions: ProjectActions) =>
    store.setProjectActions(projectId, actions),
  );
  ipcMain.handle(IPC.detectActions, async (_e, projectId: string) => {
    const project = store.getProject(projectId);
    if (!project) throw new Error("That project no longer exists.");
    const actions = await detectActions(project.path);
    store.setProjectActions(projectId, actions);
    return actions;
  });
  ipcMain.handle(IPC.resumeRun, (_e, runId: string) => manager.resume(runId));
  ipcMain.handle(IPC.runChecks, (_e, runId: string) => manager.runChecks(runId));
  ipcMain.handle(IPC.ship, (_e, runId: string, kind: ShipKind) => manager.ship(runId, kind));
  ipcMain.handle(IPC.remoteInfo, (_e, runId: string) => manager.remoteInfo(runId));
  ipcMain.handle(IPC.connectRemote, (_e, runId: string, repo: string) =>
    manager.connectRemote(runId, repo),
  );
  // Only images, and only reasonably sized ones: this is for screenshots the agent took.
  const IMAGE_TYPES: Record<string, string> = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
  };
  ipcMain.handle(IPC.readImage, async (_e, file: string) => {
    const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
    if (!type || !path.isAbsolute(file)) return null;
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > 15 * 1024 * 1024) return null;
      return `data:${type};base64,${(await readFile(file)).toString("base64")}`;
    } catch {
      return null;
    }
  });
  ipcMain.handle(IPC.startDev, async (_e, runId: string) => {
    const url = await manager.startDev(runId);
    win?.webContents.send(IPC.runChanged, runId);
    // Give the server a moment to come up before opening it.
    setTimeout(() => void shell.openExternal(url), 2500);
    return url;
  });
  ipcMain.handle(IPC.stopDev, (_e, runId: string) => {
    manager.stopDev(runId);
    win?.webContents.send(IPC.runChanged, runId);
  });
  ipcMain.handle(IPC.listOpeners, async () => {
    const found: Opener[] = [];
    for (const o of OPENERS) {
      if (
        !o.path ||
        (await access(o.path).then(
          () => true,
          () => false,
        ))
      )
        found.push({ id: o.id, name: o.name });
    }
    return found;
  });
  ipcMain.handle(IPC.openIn, async (_e, openerId: string, dir: string) => {
    const o = OPENERS.find((x) => x.id === openerId);
    if (!o) return;
    if (!existsSync(dir))
      throw new Error("This run's folder no longer exists. It was discarded or removed.");
    if (o.id === "finder") return void (await shell.openPath(dir));
    const { execFile } = await import("node:child_process");
    await new Promise<void>((resolve, reject) =>
      execFile("open", ["-a", o.app, dir], (err) => (err ? reject(err) : resolve())),
    );
  });
  ipcMain.handle(IPC.setTheme, (_e, mode: ThemeMode) => {
    nativeTheme.themeSource = mode;
    win?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? "#000000" : "#ffffff");
  });

  /** The Dock shows how many agents are working. */
  function updateBadge(): void {
    const n = manager.activeRuns().length;
    if (isMac) app.dock?.setBadge(n ? String(n) : "");
  }

  /** A system notification when a run finishes while you're looking elsewhere. */
  function notifySettled(runId: string): void {
    updateBadge();
    if (win?.isFocused() || !Notification.isSupported()) return;
    const run = store.getRun(runId);
    if (!run || run.status === "cancelled") return;
    const tests = digestRun(store.events(runId)).tests;
    const project = run.projectId ? store.getProject(run.projectId)?.name : undefined;
    const failed = run.status !== "done" || (tests && !tests.passed);
    const n = new Notification({
      title: failed ? `${project ?? "A run"} needs you` : `${project ?? "A run"} is done`,
      body: `${run.title}\n${failed ? (tests && !tests.passed ? "Checks are failing." : (run.summary ?? "It didn't finish.")) : tests ? "Checks pass." : "Finished."}`,
      silent: false,
    });
    n.on("click", () => {
      win?.show();
      win?.webContents.send(IPC.openRun, runId);
    });
    n.show();
  }
  ipcMain.handle(IPC.cancelRun, (_e, runId: string) => manager.cancel(runId));
  ipcMain.handle(
    IPC.answerApproval,
    (_e, runId: string, requestId: string, answer: ApprovalAnswer) =>
      manager.answerApproval(runId, requestId, answer),
  );
  function approvalOf(runId: string): ApprovalRequest | undefined {
    const r = manager.pendingApproval(runId);
    return r
      ? {
          id: r.id,
          tool: r.tool,
          description: r.description,
          ...(r.reason && { reason: r.reason }),
          ...(r.rule && { rule: r.rule }),
        }
      : undefined;
  }
  /** Like Claude Code's prompt, but it may be in the background: say so. */
  function notifyApproval(runId: string, what: string): void {
    updateBadge();
    if (win?.isFocused() || !Notification.isSupported()) return;
    const run = store.getRun(runId);
    const project = run?.projectId ? store.getProject(run.projectId)?.name : undefined;
    const n = new Notification({
      title: `${project ?? "A run"} needs your OK`,
      body: `Claude wants to run: ${what}`,
      silent: false,
    });
    n.on("click", () => {
      win?.show();
      win?.webContents.send(IPC.openRun, runId);
    });
    n.show();
  }
  ipcMain.handle(IPC.discardRun, (_e, runId: string) => manager.discard(runId));
  ipcMain.handle(IPC.runEvents, (_e, runId: string, afterSeq: number) =>
    store.events(runId, { afterSeq }),
  );
  ipcMain.handle(IPC.runDiff, (_e, runId: string) => manager.diff(runId));
  ipcMain.handle(IPC.revealInFinder, (_e, p: string) => shell.showItemInFolder(p));
  // Links in agent output: only web links, never file: or custom schemes.
  ipcMain.handle(IPC.openExternal, (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url);
  });

  win = createWindow();
  if (process.env.HELLOAGENTS_CAPTURE) captureAndQuit(win, process.env.HELLOAGENTS_CAPTURE);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) win = createWindow();
  });
  // Quitting while agents work: ask, then stop them cleanly so each run records where it stopped.
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    const working = manager.activeRuns().length;
    if (working && !process.env.HELLOAGENTS_CAPTURE) {
      const choice = dialog.showMessageBoxSync({
        type: "question",
        buttons: ["Stop them and quit", "Keep working"],
        defaultId: 1,
        cancelId: 1,
        message: `${working} run${working === 1 ? " is" : "s are"} still working`,
        detail:
          "Quitting stops them. Their work so far stays on their branches, and you can resume them later. To keep them working, close the window instead: helloagents keeps running in the Dock.",
      });
      if (choice === 1) {
        event.preventDefault();
        return;
      }
    }
    event.preventDefault();
    quitting = true;
    void manager.stopAll().finally(() => {
      store.close();
      app.quit();
    });
  });
});

app.on("window-all-closed", () => {
  if (!isMac) app.quit();
});
