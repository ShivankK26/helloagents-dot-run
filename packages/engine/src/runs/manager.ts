import type { ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { runAgent } from "../harness/agent";
import type { ModelClient } from "../harness/model";
import {
  commitAll,
  connectGitHub,
  createWorktree,
  currentBranch,
  git,
  headCommit,
  listBranches,
  mergeInto,
  originUrl,
  parseGitHubRepo,
  pushBranch,
  removeWorktree,
  restoreWorktree,
  type Worktree,
  worktreeDiff,
} from "../git/worktree";
import { failureExcerpt } from "../trace/views";
import type { TraceStore } from "../trace/store";
import type {
  Access,
  AgentEvent,
  AgentId,
  ProjectActions,
  ProjectRecord,
  RunSettings,
} from "../types";
import {
  DEFAULT_CLAUDE_TOOLS,
  runClaudeCode,
  type AgentControl,
  type PermissionDecision,
  type PermissionRequest,
} from "../workers/claude-code";
import { isSlashTask } from "../workers/slash";
import {
  declaredPackageManager,
  detectActions,
  installedNodes,
  openPullRequest,
  runShell,
  startBackground,
  type CommandResult,
  stopBackground,
  whyItCouldNotStart,
  withPackageManager,
} from "./actions";

export interface RunManagerOptions {
  store: TraceStore;
  /** Where agent worktrees are created (outside the user's repos). */
  worktreesRoot: string;
  /** Called whenever a run gets a new event or changes status. */
  onChange?: (runId: string) => void;
  /** Called once a run's work has fully stopped (agent, checks and retries). */
  onSettled?: (runId: string) => void;
  /** An agent is waiting for the user's OK to do something. */
  onApproval?: (runId: string, request: PermissionRequest) => void;
  /** Path to the claude CLI; tests use a fake. */
  claudePath?: string;
  /** Builds the model for the built-in harness. Throws if no API key is set. */
  createModel?: () => ModelClient;
}

/** What the project screen shows above the composer. */
export interface ProjectInfo {
  branch: string | null;
  head: string;
  branches: string[];
  actions: ProjectActions;
}

export type ShipKind = "commit" | "push" | "pr" | "merge";

export interface ShipResult {
  message: string;
  url?: string;
}

/** Failing checks go back to the agent at most this many times per request. */
const MAX_SEND_BACKS = 2;

/** Starts, tracks and cancels runs: one agent, on its own branch, per run. */
export class RunManager {
  private readonly active = new Map<string, AbortController>();
  private readonly done = new Map<string, Promise<void>>();
  private readonly devServers = new Map<string, ChildProcess>();

  constructor(private readonly opts: RunManagerOptions) {}

  /** The project's actions, detected from its files the first time they're needed. */
  async projectActions(project: ProjectRecord): Promise<ProjectActions> {
    if (project.actions) return project.actions;
    const actions = await detectActions(project.path);
    this.opts.store.setProjectActions(project.id, actions);
    return actions;
  }

  async projectInfo(projectId: string): Promise<ProjectInfo> {
    const project = this.requireProject(projectId);
    const [branch, head, branches, actions] = await Promise.all([
      currentBranch(project.path).catch(() => null),
      headCommit(project.path).catch(() => ""),
      listBranches(project.path).catch(() => []),
      this.projectActions(project),
    ]);
    return { branch, head, branches, actions };
  }

  /** Creates the run and returns its id right away; the agent keeps working in the background. */
  async start(projectId: string, task: string, settings: RunSettings = {}): Promise<string> {
    const { store } = this.opts;
    const project = this.requireProject(projectId);
    const runId = randomUUID();
    const notify = () => this.opts.onChange?.(runId);
    const inPlace = settings.workspace === "checkout";
    const baseBranch = (await currentBranch(project.path).catch(() => null)) ?? undefined;
    const runSettings: RunSettings = { ...settings, baseBranch: settings.base ?? baseBranch };

    let worktree: Worktree;
    try {
      worktree = inPlace
        ? {
            path: project.path,
            branch: baseBranch ?? "HEAD",
            base: (await headCommit(project.path)).trim(),
          }
        : await createWorktree(
            project.path,
            this.opts.worktreesRoot,
            `${runId.slice(0, 6)}-${task.split(/\s+/).slice(0, 6).join("-")}`,
            settings.base ?? "HEAD",
          );
    } catch (error) {
      store.createRun({
        id: runId,
        title: task,
        workspace: project.path,
        model: settings.model ?? project.workerAgent,
        projectId,
        agent: project.workerAgent,
        settings: runSettings,
      });
      store.failRun(
        runId,
        inPlace
          ? "Couldn't read this project's git state."
          : "Couldn't create a separate branch for this run.",
        explainGitError(error),
      );
      notify();
      this.opts.onSettled?.(runId);
      return runId;
    }

    store.createRun({
      id: runId,
      title: task,
      workspace: worktree.path,
      model: settings.model ?? project.workerAgent,
      projectId,
      agent: project.workerAgent,
      worktree,
      settings: runSettings,
    });
    notify();

    const actions = await this.projectActions(project);
    this.work(runId, {
      agent: project.workerAgent,
      task,
      workspace: worktree.path,
      settings: runSettings,
      actions,
      setup: !inPlace && actions.setup ? actions.setup : undefined,
    });
    return runId;
  }

  /**
   * Sends a follow-up to a finished run: same branch, and for Claude Code the
   * same conversation, so the agent remembers what it already did.
   */
  async followUp(runId: string, message: string, attachments?: string[]): Promise<void> {
    const { store } = this.opts;
    const run = store.getRun(runId);
    if (!run?.worktree) throw new Error("This run has no branch to continue on.");
    if (this.active.has(runId)) {
      // Working: the agent reads it now, like typing into Claude Code mid-task. Between
      // steps (e.g. while checks run), it's sent as a follow-up once the run finishes.
      const text = withAttachments(message, attachments ?? []);
      if (this.controls.get(runId)?.say(text)) return;
      void this.settled(runId).then(() => this.followUp(runId, message, attachments));
      return;
    }
    const project = run.projectId ? store.getProject(run.projectId) : undefined;
    const actions = project ? await this.projectActions(project) : undefined;
    // A folder freed to save space comes back from the branch, installed again.
    const restored = await this.ensureFolder(runId);
    store.reopenRun(runId);
    this.opts.onChange?.(runId);
    this.work(runId, {
      agent: run.agent ?? "claude-code",
      task: this.withApprovalNote(runId, message, run.settings.access),
      workspace: run.worktree.path,
      ...(restored && actions?.setup && { setup: actions.setup }),
      // Images belong to the message they came with.
      settings: { ...run.settings, attachments: attachments ?? [] },
      actions,
      resumeSessionId: this.sessionOf(runId),
    });
  }

  /**
   * If commands were auto-denied earlier in this conversation (before approvals
   * existed, or with nobody to ask), the agent believes that still holds. Say once,
   * in the message itself, that it no longer does.
   */
  private withApprovalNote(runId: string, message: string, access?: string): string {
    if (access === "full") return message;
    const events = this.opts.store.events(runId).map((e) => e.event);
    const lastNote = events.findLastIndex(
      (e) => e.type === "agent.start" && e.task.includes(NOTE_HEADER),
    );
    const deniedSince = events
      .slice(lastNote + 1)
      .some((e) => e.type === "tool.result" && !e.ok && AUTO_DENIED.test(e.output));
    if (!deniedSince) return message;
    return `${message}\n\n${NOTE_HEADER}\nCommands that need permission are no longer denied automatically: helloagents now asks the user, who can approve them. Earlier messages saying approval-needing commands would be refused for the rest of this session no longer apply. Try the commands you need again (for example builds, simulators, screenshots).`;
  }

  /** Continues a run that was stopped, in the same conversation. */
  resume(runId: string): Promise<void> {
    return this.followUp(
      runId,
      "You were stopped before you finished. Continue where you left off, then summarize what you did.",
    );
  }

  /** Runs the project's checks on a run's branch and records the result. */
  async runChecks(runId: string): Promise<void> {
    const { store } = this.opts;
    const run = store.getRun(runId);
    if (!run?.worktree || !run.projectId) throw new Error("This run has no branch to check.");
    if (this.active.has(runId))
      throw new Error("This run is still working. Wait for it to finish.");
    const actions = await this.projectActions(this.requireProject(run.projectId));
    if (!actions.checks.length)
      throw new Error("This project has no checks yet. Add one in its actions.");
    const workspace = run.worktree.path;
    const restored = await this.ensureFolder(runId);
    this.track(runId, async (signal) => {
      if (restored && actions.setup)
        await this.command(runId, "setup", [actions.setup], workspace, signal, actions);
      await this.checks(runId, actions, workspace, signal);
    });
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  activeRuns(): string[] {
    return [...this.active.keys()];
  }

  cancel(runId: string): void {
    this.approvals.get(runId)?.resolve({ behavior: "deny", message: "Stopped by the user." });
    this.approvals.delete(runId);
    this.active.get(runId)?.abort();
  }

  // ---- Approvals ----

  private approvals = new Map<
    string,
    { request: PermissionRequest; resolve: (d: PermissionDecision) => void }
  >();

  /** What a run is waiting for the user to approve, if anything. */
  pendingApproval(runId: string): PermissionRequest | undefined {
    return this.approvals.get(runId)?.request;
  }

  private controls = new Map<string, AgentControl>();

  /** Changes how much a run may do without asking, now and for its next turns. */
  setRunAccess(runId: string, access: Access): void {
    const run = this.opts.store.getRun(runId);
    if (!run) return;
    this.opts.store.updateRunSettings(runId, { ...run.settings, access });
    this.controls.get(runId)?.setAccess(access);
    this.opts.onChange?.(runId);
  }

  /** Answers a run's approval: allow once, always (for this project), or deny. */
  async answerApproval(
    runId: string,
    requestId: string,
    answer: "allow" | "always" | "auto" | "deny",
  ): Promise<void> {
    // "auto": allow this, and let the run decide the safe things itself from now on.
    if (answer === "auto") this.setRunAccess(runId, "auto");
    const pending = this.approvals.get(runId);
    if (!pending || pending.request.id !== requestId) return;
    this.approvals.delete(runId);
    const rule = pending.request.rule;
    if (answer === "always" && rule) {
      const projectId = this.opts.store.getRun(runId)?.projectId;
      const project = projectId ? this.opts.store.getProject(projectId) : undefined;
      if (project) {
        const actions = await this.projectActions(project);
        const alwaysAllow = [...new Set([...(actions.alwaysAllow ?? []), rule])];
        this.opts.store.setProjectActions(project.id, { ...actions, alwaysAllow });
      }
    }
    pending.resolve(
      answer === "deny"
        ? {
            behavior: "deny",
            message: "The user said no. Don't try this again; continue without it.",
          }
        : { behavior: "allow", always: answer === "always" },
    );
    this.opts.onChange?.(runId);
  }

  /** Stops every agent and dev server, and waits for them to record where they stopped. */
  async stopAll(timeoutMs = 8000): Promise<void> {
    const runs = this.activeRuns();
    runs.forEach((id) => this.cancel(id));
    for (const child of this.devServers.values()) stopBackground(child);
    this.devServers.clear();
    await Promise.race([
      Promise.all(runs.map((id) => this.settled(id))),
      new Promise((r) => setTimeout(r, timeoutMs)),
    ]);
  }

  /** Resolves when the run's agent has stopped. */
  async settled(runId: string): Promise<void> {
    await this.done.get(runId);
  }

  /** Everything the agent changed on its branch. */
  async diff(runId: string): Promise<string> {
    const run = this.opts.store.getRun(runId);
    if (!run?.worktree) return "";
    const project = run.projectId ? this.opts.store.getProject(run.projectId) : undefined;
    // After a push the folder is gone, but the branch has every change. A git error is
    // reported, not shown as "no changes".
    if (!existsSync(run.worktree.path) && project)
      return git(project.path, ["diff", `${run.worktree.base}...${run.worktree.branch}`]);
    return worktreeDiff(run.worktree);
  }

  /** Deletes the run's worktree and branch. The run's history is kept. */
  async discard(runId: string): Promise<void> {
    const run = this.opts.store.getRun(runId);
    const project = run?.projectId ? this.opts.store.getProject(run.projectId) : undefined;
    if (!run?.worktree || !project) return;
    if (run.settings.workspace === "checkout") {
      throw new Error(
        "This run worked in your own checkout, so there's no separate branch to delete.",
      );
    }
    this.cancel(runId);
    this.stopDev(runId);
    await this.settled(runId);
    await removeWorktree(project.path, run.worktree, { deleteBranch: true });
    this.recordFolder(runId, "discarded", "Deleted this run's folder and branch.");
  }

  // ---- Disk space ----
  // Each run's folder is a full copy of the project (often with node_modules), so it's
  // removed once the work is pushed, in a PR or merged. The branch always stays, and
  // the folder comes back on its own if the run is continued.

  /** "here", "freed" (to save space; comes back on use) or "gone" (discarded). */
  folderState(runId: string): "here" | "freed" | "gone" {
    const run = this.opts.store.getRun(runId);
    if (!run?.worktree || existsSync(run.worktree.path)) return "here";
    const last = this.opts.store
      .events(runId)
      .map((e) => e.event)
      .filter((e) => e.type === "tool.result" && e.name === "folder")
      .at(-1);
    return last?.type === "tool.result" && (last.input as { action?: string }).action === "freed"
      ? "freed"
      : "gone";
  }

  /** Deletes a finished run's folder; its branch stays. Returns the bytes freed. */
  async freeFolder(runId: string): Promise<number | null> {
    const run = this.opts.store.getRun(runId);
    const project = run?.projectId ? this.opts.store.getProject(run.projectId) : undefined;
    const wt = run?.worktree;
    if (!run || !project || !wt || this.active.has(runId) || this.devServers.has(runId))
      return null;
    if (run.settings.workspace === "checkout" || wt.path === project.path || !existsSync(wt.path))
      return null;
    const bytes = await folderSize(wt.path);
    await commitAll(wt.path, `Unsaved work from helloagents: ${commitMessage(run.title)}`).catch(
      () => null,
    );
    await removeWorktree(project.path, wt);
    this.recordFolder(
      runId,
      "freed",
      `Freed ${formatBytes(bytes)}: removed this run's folder to save space. The branch is kept, and the folder comes back if you continue.`,
      bytes,
    );
    return bytes;
  }

  /** Brings back a freed run's folder from its branch. True if it had to (install again). */
  private async ensureFolder(runId: string): Promise<boolean> {
    const run = this.opts.store.getRun(runId);
    const project = run?.projectId ? this.opts.store.getProject(run.projectId) : undefined;
    if (!run?.worktree || !project || existsSync(run.worktree.path)) return false;
    if (this.folderState(runId) !== "freed")
      throw new Error("This run's branch was deleted, so it can't continue.");
    await restoreWorktree(project.path, run.worktree);
    this.recordFolder(runId, "restored", "Brought this run's folder back from its branch.");
    return true;
  }

  private recordFolder(runId: string, action: string, output: string, bytes?: number): void {
    this.opts.store.record(runId, "main", {
      type: "tool.result",
      at: Date.now(),
      turn: 0,
      id: randomUUID(),
      name: "folder",
      input: { action, ...(bytes !== undefined && { bytes }) },
      ok: true,
      output,
      durationMs: 0,
    });
    this.opts.onChange?.(runId);
  }

  /**
   * Removes a project from helloagents. Its own folder is never touched. Each run's
   * separate folder is cleaned up, but unsaved work is committed to the run's branch
   * first, so nothing an agent wrote is lost; the branches stay in the repo.
   */
  async removeProject(projectId: string): Promise<void> {
    const { store } = this.opts;
    const project = this.requireProject(projectId);
    const runs = store.listProjectRuns(projectId, 10_000);
    for (const run of runs) this.cancel(run.id);
    for (const run of runs) {
      await this.settled(run.id);
      this.stopDev(run.id);
      const wt = run.worktree;
      if (!wt || run.settings.workspace === "checkout" || wt.path === project.path) continue;
      try {
        await commitAll(wt.path, `Unsaved work from helloagents: ${commitMessage(run.title)}`);
      } catch {
        // folder already gone, or nothing to save
      }
      try {
        await removeWorktree(project.path, wt);
      } catch {
        // already removed
      }
    }
    store.removeProject(projectId);
  }

  // ---- Ship ----

  /** Commit, push, open a PR or merge, recorded in the run's activity either way. */
  async ship(runId: string, kind: ShipKind): Promise<ShipResult> {
    const started = Date.now();
    const record = (ok: boolean, output: string, url?: string) => {
      this.opts.store.record(runId, "main", {
        type: "tool.result",
        at: Date.now(),
        turn: 0,
        id: randomUUID(),
        name: "ship",
        input: { kind, ...(url && { url }) },
        ok,
        output,
        durationMs: Date.now() - started,
      });
      this.opts.onChange?.(runId);
    };
    try {
      await this.ensureFolder(runId);
      const result =
        kind === "commit"
          ? await this.commit(runId)
          : kind === "push"
            ? await this.push(runId)
            : kind === "pr"
              ? await this.openPullRequest(runId)
              : await this.merge(runId);
      record(true, result.message, result.url);
      // Pushed, in a PR or merged: the work is safe in git, so the run's folder can go.
      if (kind !== "commit") await this.freeFolder(runId).catch(() => null);
      return result;
    } catch (e) {
      record(false, e instanceof Error ? e.message : String(e));
      throw e;
    }
  }

  /** Where a run's project pushes to, and a guess at where it should if it has no remote yet. */
  async remoteInfo(runId: string): Promise<{ url: string | null; suggestion: string }> {
    const { project } = this.shippable(runId);
    const url = await originUrl(project.path);
    if (url) return { url, suggestion: parseGitHubRepo(url) ?? url };
    // A repo the user or agent mentioned ("github.com/me/app"), else their account + the folder name.
    const texts = this.opts.store
      .events(runId)
      .flatMap(({ event: e }) =>
        e.type === "agent.start" ? [e.task] : e.type === "model.response" ? [e.text] : [],
      );
    for (const t of texts.reverse()) {
      const m = /github\.com\/([\w.-]+\/[\w.-]+?)(?:\.git)?\b/.exec(t);
      if (m?.[1]) return { url: null, suggestion: m[1] };
    }
    const login = await new Promise<string>((resolve) =>
      execFile("gh", ["api", "user", "--jq", ".login"], (err, out) =>
        resolve(err ? "" : out.trim()),
      ),
    );
    const slug = path
      .basename(project.path)
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-");
    return { url: null, suggestion: login ? `${login}/${slug}` : slug };
  }

  /** Puts the run's project on GitHub (an existing repo, or a new private one). */
  async connectRemote(runId: string, target: string): Promise<ShipResult> {
    const { run, project } = this.shippable(runId);
    const base = run.settings.baseBranch ?? (await currentBranch(project.path)) ?? "main";
    const r = await connectGitHub(project.path, target, base);
    const message = r.created
      ? `Created ${r.url.replace("https://", "")} (private) and connected it`
      : `Connected to ${r.url.replace("https://", "")}`;
    this.opts.store.record(runId, "main", {
      type: "tool.result",
      at: Date.now(),
      turn: 0,
      id: randomUUID(),
      name: "ship",
      input: { kind: "connect", url: r.url },
      ok: true,
      output: message,
      durationMs: 0,
    });
    this.opts.onChange?.(runId);
    return {
      message,
      url: r.url,
    };
  }

  async commit(runId: string): Promise<ShipResult> {
    const { run } = this.shippable(runId);
    const sha = await commitAll(run.worktree.path, commitMessage(run.title));
    return {
      message: sha ? `Committed ${sha} on ${run.worktree.branch}` : "Nothing new to commit.",
    };
  }

  async push(runId: string): Promise<ShipResult> {
    const { run } = this.shippable(runId);
    if (!(await originUrl(run.worktree.path)))
      throw new Error("This project isn't on GitHub yet. Connect it first.");
    await commitAll(run.worktree.path, commitMessage(run.title));
    await pushBranch(run.worktree.path, run.worktree.branch);
    return { message: `Pushed ${run.worktree.branch}` };
  }

  async openPullRequest(runId: string): Promise<ShipResult> {
    const { run } = this.shippable(runId);
    if (run.settings.workspace === "checkout") {
      throw new Error(
        "This run worked on your current branch. Push it and open the pull request from there.",
      );
    }
    await commitAll(run.worktree.path, commitMessage(run.title));
    await pushBranch(run.worktree.path, run.worktree.branch);
    const checks = [...this.opts.store.events(runId)]
      .reverse()
      .find((e) => e.event.type === "tool.result" && e.event.name === "checks")?.event;
    const checkLine =
      checks?.type === "tool.result"
        ? `\n\n**Checks:** ${checks.ok ? "passing" : "failing"} (${((checks.input as { commands?: string[] }).commands ?? []).join(", ")})`
        : "";
    const url = await openPullRequest(run.worktree.path, {
      branch: run.worktree.branch,
      base: run.settings.baseBranch ?? "main",
      title: commitMessage(run.title),
      body: `${run.summary ?? run.title}${checkLine}\n\n_Opened from helloagents._`,
    });
    return { message: "Opened a pull request", url };
  }

  async merge(runId: string): Promise<ShipResult> {
    const { run, project } = this.shippable(runId);
    if (run.settings.workspace === "checkout") {
      throw new Error("This run already worked on your current branch. Commit it instead.");
    }
    const into = run.settings.baseBranch;
    if (!into) throw new Error("Couldn't tell which branch this run started from.");
    await commitAll(run.worktree.path, commitMessage(run.title));
    await mergeInto(project.path, run.worktree.branch, into);
    // "In main" should mean on GitHub too, when the project is there.
    if (await originUrl(project.path)) {
      await git(project.path, ["push", "origin", into]);
      return { message: `Merged into ${into} and pushed it to GitHub` };
    }
    return { message: `Merged into ${into}` };
  }

  // ---- Dev server ----

  /** Starts the project's dev server on a run's branch and returns its URL. */
  async startDev(runId: string): Promise<string> {
    const { store } = this.opts;
    const run = store.getRun(runId);
    if (!run?.worktree || !run.projectId) throw new Error("This run has no branch to serve.");
    const actions = await this.projectActions(this.requireProject(run.projectId));
    if (!actions.dev)
      throw new Error("This project has no dev server command. Add one in its actions.");
    if (!this.devServers.has(runId)) {
      if ((await this.ensureFolder(runId)) && actions.setup)
        await runShell(actions.setup, run.worktree.path, { nodeBin: actions.nodeBin });
      for (const [id, child] of this.devServers) {
        stopBackground(child); // one at a time: they usually share a port
        this.devServers.delete(id);
      }
      this.devServers.set(
        runId,
        startBackground(actions.dev.command, run.worktree.path, actions.nodeBin),
      );
    }
    return actions.dev.url;
  }

  stopDev(runId: string): void {
    const child = this.devServers.get(runId);
    if (child) stopBackground(child);
    this.devServers.delete(runId);
  }

  devRunning(runId: string): boolean {
    return this.devServers.has(runId);
  }

  // ---- Internals ----

  private requireProject(projectId: string): ProjectRecord {
    const project = this.opts.store.getProject(projectId);
    if (!project) throw new Error("That project no longer exists.");
    return project;
  }

  private shippable(runId: string) {
    const run = this.opts.store.getRun(runId);
    if (!run?.worktree || !run.projectId) throw new Error("This run has no branch to ship.");
    if (this.active.has(runId))
      throw new Error("This run is still working. Wait for it to finish.");
    return { run: { ...run, worktree: run.worktree }, project: this.requireProject(run.projectId) };
  }

  private sessionOf(runId: string): string | undefined {
    return this.opts.store
      .events(runId)
      .map(({ event }) => ("sessionId" in event ? event.sessionId : undefined))
      .filter(Boolean)
      .at(-1);
  }

  /** Runs `job` as this run's background work, with a way to cancel it. */
  private track(runId: string, job: (signal: AbortSignal) => Promise<void>): void {
    const controller = new AbortController();
    this.active.set(runId, controller);
    const work = (async () => {
      try {
        await job(controller.signal);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Short, plain errors (ours) make a good summary; long ones go in the details.
        const summary =
          message.length <= 120 && !message.includes("\n") ? message : "The run couldn't continue.";
        this.opts.store.failRun(runId, summary, message);
      } finally {
        this.active.delete(runId);
        this.opts.onChange?.(runId);
        this.opts.onSettled?.(runId);
      }
    })();
    this.done.set(runId, work);
  }

  private work(
    runId: string,
    w: {
      agent: AgentId;
      task: string;
      workspace: string;
      settings: RunSettings;
      actions?: ProjectActions;
      setup?: string;
      resumeSessionId?: string;
    },
  ): void {
    const { store } = this.opts;
    const notify = () => this.opts.onChange?.(runId);
    const record = (event: AgentEvent) => {
      store.record(runId, "main", event);
      notify();
    };

    this.track(runId, async (signal) => {
      if (w.setup) {
        const { ok } = await this.command(
          runId,
          "setup",
          [w.setup],
          w.workspace,
          signal,
          w.actions,
        );
        if (!ok) {
          store.failRun(
            runId,
            "Setup failed, so the agent didn't start.",
            `${w.setup} failed. See its output above.`,
          );
          return;
        }
      }

      let task = w.task;
      let session = w.resumeSessionId;
      for (let round = 0; ; round++) {
        if (signal.aborted) return;
        if (round > 0) {
          store.reopenRun(runId);
          notify();
        }
        const status = await this.agentTurn(w.agent, {
          runId,
          alwaysAllow: w.actions?.alwaysAllow ?? [],
          task,
          workspace: w.workspace,
          settings: w.settings,
          signal,
          onEvent: record,
          resumeSessionId: session,
        });
        if (status !== "done" || signal.aborted || !w.actions?.checks.length) return;

        const { failure, cantStart } = await this.checks(runId, w.actions, w.workspace, signal);
        // A check that couldn't start says nothing about the code; the agent can't fix it.
        if (
          !failure ||
          cantStart ||
          !w.actions.sendBackFailures ||
          round >= MAX_SEND_BACKS ||
          signal.aborted
        )
          return;
        task = `The project's checks failed after your changes:\n\n${failure}\n\nFix the cause, then summarize what you changed.`;
        session = this.sessionOf(runId);
      }
    });
  }

  /** One agent turn. Resolves with how it ended. */
  private async agentTurn(
    agent: AgentId,
    t: {
      runId: string;
      alwaysAllow: string[];
      task: string;
      workspace: string;
      settings: RunSettings;
      signal: AbortSignal;
      onEvent: (e: AgentEvent) => void;
      resumeSessionId?: string;
    },
  ): Promise<string> {
    if (agent === "claude-code") {
      const attachments = t.settings.attachments ?? [];
      const r = await runClaudeCode({
        task: withAttachments(t.task, attachments),
        // Slash commands and skills need the user's full Claude Code setup.
        lean: !isSlashTask(t.task),
        ...(attachments.length && {
          addDirs: [...new Set(attachments.map((a) => path.dirname(a)))],
        }),
        workspace: t.workspace,
        signal: t.signal,
        onEvent: t.onEvent,
        allowedTools: [...DEFAULT_CLAUDE_TOOLS, ...t.alwaysAllow],
        onControl: (control) => this.controls.set(t.runId, control),
        // Anything else waits for the user's OK, like Claude Code's own prompt.
        onPermission: (request) =>
          new Promise<PermissionDecision>((resolve) => {
            if (t.signal.aborted) return resolve({ behavior: "deny" });
            this.approvals.set(t.runId, { request, resolve });
            this.opts.onChange?.(t.runId);
            this.opts.onApproval?.(t.runId, request);
          }),
        ...(t.resumeSessionId && { resumeSessionId: t.resumeSessionId }),
        ...(t.settings.model && { model: t.settings.model }),
        ...(t.settings.effort && { effort: t.settings.effort }),
        ...(t.settings.access && { access: t.settings.access }),
        ...(this.opts.claudePath && { claudePath: this.opts.claudePath }),
      });
      return r.status;
    }
    if (agent === "harness") {
      if (!this.opts.createModel)
        throw new Error("The built-in agent isn't set up on this machine.");
      const r = await runAgent({
        task: t.task,
        workspace: t.workspace,
        model: this.opts.createModel(),
        signal: t.signal,
        onEvent: t.onEvent,
      });
      return r.status;
    }
    throw new Error(
      "Codex isn't supported yet. Switch this project's agent to Claude Code for now.",
    );
  }

  /** Runs the checks and records them as one step. Returns the failure to send back, or null if they pass. */
  private async checks(
    runId: string,
    actions: ProjectActions,
    workspace: string,
    signal: AbortSignal,
  ): Promise<{ failure: string | null; cantStart: boolean }> {
    let failure: string | null = null;
    const { cantStart } = await this.command(
      runId,
      "checks",
      actions.checks,
      workspace,
      signal,
      actions,
      (cmd, output) => {
        failure ??= `$ ${cmd}\n${failureExcerpt(output, 40)}`;
      },
    );
    return { failure, cantStart };
  }

  /** Runs commands one after another and records them as a single step named `name`. */
  private async command(
    runId: string,
    name: "setup" | "checks",
    commands: string[],
    workspace: string,
    signal: AbortSignal,
    actions?: ProjectActions,
    onFail?: (command: string, output: string) => void,
  ): Promise<{ ok: boolean; cantStart: boolean }> {
    const started = Date.now();
    let ok = true;
    let cantStart: string | undefined;
    const parts: string[] = [];
    for (const original of commands) {
      if (signal.aborted) break;
      let cmd = original;
      let r = await runShell(cmd, workspace, { signal, nodeBin: actions?.nodeBin });
      let note = "";
      const why = r.ok ? null : whyItCouldNotStart(r.output);
      if (why && actions) {
        const fixed = await this.fixEnvironment(runId, cmd, workspace, actions, signal);
        if (fixed) {
          ({ command: cmd, result: r, note } = fixed);
        } else {
          cantStart ??= why;
          note = `This couldn't start, so it says nothing about the code: ${why}.`;
        }
      }
      parts.push(
        `$ ${cmd}\n${note ? `[helloagents] ${note}\n\n` : ""}${r.output || "(no output)"}${r.ok ? "" : `\n(exit code ${r.exitCode ?? "?"})`}`,
      );
      if (!r.ok) {
        ok = false;
        onFail?.(cmd, r.output);
      }
    }
    this.opts.store.record(runId, "main", {
      type: "tool.result",
      at: Date.now(),
      turn: 0,
      id: randomUUID(),
      name,
      input: { commands, ...(cantStart && { cantStart }) },
      ok,
      output: parts.join("\n\n"),
      durationMs: Date.now() - started,
    });
    this.opts.onChange?.(runId);
    return { ok, cantStart: Boolean(cantStart) };
  }

  /**
   * A command couldn't start (wrong package manager, too old a Node). Tries the
   * package manager package.json asks for and newer Nodes installed on this
   * Mac. If one gets the command running, it's saved for the project.
   */
  private async fixEnvironment(
    runId: string,
    command: string,
    workspace: string,
    actions: ProjectActions,
    signal: AbortSignal,
  ): Promise<{ command: string; result: CommandResult; note: string } | null> {
    const declared = await declaredPackageManager(workspace);
    const commands = [
      ...new Set([declared ? withPackageManager(command, declared) : command, command]),
    ];
    const nodes = [
      actions.nodeBin ?? null,
      ...(await installedNodes()).slice(0, 3).map((n) => n.bin),
    ];
    const versions = new Map((await installedNodes()).map((n) => [n.bin, n.version]));
    const hasModules = await stat(path.join(workspace, "node_modules")).then(
      () => true,
      () => false,
    );
    for (const nodeBin of [...new Set(nodes)]) {
      for (const cmd of commands) {
        if (signal.aborted) return null;
        if (cmd === command && nodeBin === (actions.nodeBin ?? null)) continue; // already failed
        // Install first if the failed setup left nothing installed.
        if (!hasModules && actions.setup && command !== actions.setup) {
          const setup = declared ? withPackageManager(actions.setup, declared) : actions.setup;
          const s = await runShell(setup, workspace, { signal, nodeBin });
          if (!s.ok && whyItCouldNotStart(s.output)) continue;
        }
        const result = await runShell(cmd, workspace, { signal, nodeBin });
        if (!result.ok && whyItCouldNotStart(result.output)) continue;

        // It runs now. Remember what worked for this project.
        const changes: string[] = [];
        if (cmd !== command && declared) {
          const swap = (c: string) => withPackageManager(c, declared);
          actions.setup = actions.setup && swap(actions.setup);
          actions.checks = actions.checks.map(swap);
          if (actions.dev) actions.dev = { ...actions.dev, command: swap(actions.dev.command) };
          changes.push(`used ${declared}, which package.json asks for`);
        }
        if (nodeBin !== (actions.nodeBin ?? null)) {
          actions.nodeBin = nodeBin;
          changes.push(
            `used Node ${(nodeBin && versions.get(nodeBin)) ?? "default"}, since the default was too old`,
          );
        }
        const projectId = this.opts.store.getRun(runId)?.projectId;
        if (projectId) this.opts.store.setProjectActions(projectId, actions);
        return {
          command: cmd,
          result,
          note: `Fixed the setup on its own: ${changes.join(" and ")}. Saved for this project.`,
        };
      }
    }
    return null;
  }
}

/** Marks a note helloagents adds to a message for the agent; the app hides it. */
export const NOTE_HEADER = "[Note from helloagents]";

/**
 * Claude Code's own words when it auto-denies a prompt nobody could answer; it
 * also tells the agent this holds "for the rest of this session".
 */
const AUTO_DENIED = /no approval surface|denied automatically|requires approval/i;

/** Marks where attached images are listed in a prompt; the app hides this part. */
export const ATTACHMENTS_HEADER = "[Attached images]";

/** Adds attached images to the prompt so the agent knows to look at them. */
export function withAttachments(task: string, attachments: readonly string[]): string {
  if (!attachments.length) return task;
  const list = attachments.map((a) => `- ${a}`).join("\n");
  return `${task}\n\n${ATTACHMENTS_HEADER}\nThe user attached these images for reference. Read them with the Read tool:\n${list}`;
}

function commitMessage(title: string): string {
  const line = title.split("\n")[0]?.trim() ?? "Changes from helloagents";
  const short = line.length > 72 ? `${line.slice(0, 69)}…` : line;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

function explainGitError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ambiguous argument 'HEAD'|unknown revision|Needed a single revision/i.test(message)) {
    return "This repository has no commits yet, or that branch doesn't exist. Make a first commit, then try again.";
  }
  if (/not a git repository/i.test(message)) return "This folder isn't a git repository.";
  return message;
}

/** Disk space a folder uses, in bytes (via du, which is fast on big node_modules). */
function folderSize(dir: string): Promise<number> {
  return new Promise((resolve) =>
    execFile("du", ["-sk", dir], (err, out) =>
      resolve(err ? 0 : Number(out.trim().split(/\s+/)[0] ?? 0) * 1024),
    ),
  );
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
