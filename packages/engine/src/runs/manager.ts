import { randomUUID } from "node:crypto";
import { runAgent } from "../harness/agent";
import type { ModelClient } from "../harness/model";
import { createWorktree, removeWorktree, worktreeDiff, type Worktree } from "../git/worktree";
import type { TraceStore } from "../trace/store";
import type { AgentEvent } from "../types";
import { runClaudeCode } from "../workers/claude-code";

export interface RunManagerOptions {
  store: TraceStore;
  /** Where agent worktrees are created (outside the user's repos). */
  worktreesRoot: string;
  /** Called whenever a run gets a new event or changes status. */
  onChange?: (runId: string) => void;
  /** Path to the claude CLI; tests use a fake. */
  claudePath?: string;
  /** Builds the model for the built-in harness. Throws if no API key is set. */
  createModel?: () => ModelClient;
}

/** Starts, tracks and cancels runs: one agent, on its own branch, per run. */
export class RunManager {
  private readonly active = new Map<string, AbortController>();
  private readonly done = new Map<string, Promise<void>>();

  constructor(private readonly opts: RunManagerOptions) {}

  /** Creates the run and returns its id right away; the agent keeps working in the background. */
  async start(projectId: string, task: string): Promise<string> {
    const { store } = this.opts;
    const project = store.getProject(projectId);
    if (!project) throw new Error("That project no longer exists.");
    const runId = randomUUID();
    const notify = () => this.opts.onChange?.(runId);

    let worktree: Worktree;
    try {
      worktree = await createWorktree(
        project.path,
        this.opts.worktreesRoot,
        `${runId.slice(0, 6)}-${task.split(/\s+/).slice(0, 6).join("-")}`,
      );
    } catch (error) {
      store.createRun({
        id: runId,
        title: task,
        workspace: project.path,
        model: project.workerAgent,
        projectId,
        agent: project.workerAgent,
      });
      store.failRun(
        runId,
        "Couldn't create a separate branch for this run.",
        explainGitError(error),
      );
      notify();
      return runId;
    }

    store.createRun({
      id: runId,
      title: task,
      workspace: worktree.path,
      model: project.workerAgent,
      projectId,
      agent: project.workerAgent,
      worktree,
    });
    notify();

    const controller = new AbortController();
    this.active.set(runId, controller);
    const onEvent = (event: AgentEvent) => {
      store.record(runId, "main", event);
      notify();
    };

    const work = (async () => {
      try {
        if (project.workerAgent === "claude-code") {
          await runClaudeCode({
            task,
            workspace: worktree.path,
            signal: controller.signal,
            onEvent,
            ...(this.opts.claudePath && { claudePath: this.opts.claudePath }),
          });
        } else if (project.workerAgent === "harness") {
          if (!this.opts.createModel)
            throw new Error("The built-in agent isn't set up on this machine.");
          await runAgent({
            task,
            workspace: worktree.path,
            model: this.opts.createModel(),
            signal: controller.signal,
            onEvent,
          });
        } else {
          store.failRun(
            runId,
            "Codex isn't supported yet.",
            "Codex CLI support is coming next. Switch this project's agent to Claude Code for now.",
          );
        }
      } catch (error) {
        store.failRun(
          runId,
          "The run couldn't start.",
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        this.active.delete(runId);
        notify();
      }
    })();
    this.done.set(runId, work);
    return runId;
  }

  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  cancel(runId: string): void {
    this.active.get(runId)?.abort();
  }

  /** Resolves when the run's agent has stopped. */
  async settled(runId: string): Promise<void> {
    await this.done.get(runId);
  }

  /** Everything the agent changed on its branch. */
  async diff(runId: string): Promise<string> {
    const run = this.opts.store.getRun(runId);
    if (!run?.worktree) return "";
    try {
      return await worktreeDiff(run.worktree);
    } catch {
      return "";
    }
  }

  /** Deletes the run's worktree and branch. The run's history is kept. */
  async discard(runId: string): Promise<void> {
    const run = this.opts.store.getRun(runId);
    const project = run?.projectId ? this.opts.store.getProject(run.projectId) : undefined;
    if (!run?.worktree || !project) return;
    this.cancel(runId);
    await this.settled(runId);
    await removeWorktree(project.path, run.worktree, { deleteBranch: true });
  }
}

function explainGitError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/ambiguous argument 'HEAD'|unknown revision/i.test(message)) {
    return "This repository has no commits yet. Make a first commit, then try again.";
  }
  if (/not a git repository/i.test(message)) return "This folder isn't a git repository.";
  return message;
}
