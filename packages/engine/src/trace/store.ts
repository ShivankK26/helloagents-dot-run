import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type {
  AgentEvent,
  AgentId,
  ProjectActions,
  ProjectRecord,
  RunRecord,
  RunSettings,
  RunStatus,
  StoredEvent,
} from "../types";

export type { RunRecord, RunStatus, StoredEvent } from "../types";

// Each entry upgrades the database by one version. Never edit an old entry;
// add a new one, so existing databases upgrade cleanly.
const MIGRATIONS = [
  `CREATE TABLE runs (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     workspace TEXT NOT NULL,
     model TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'running',
     started_at INTEGER NOT NULL,
     ended_at INTEGER,
     cost_usd REAL NOT NULL DEFAULT 0,
     input_tokens INTEGER NOT NULL DEFAULT 0,
     output_tokens INTEGER NOT NULL DEFAULT 0,
     cache_read_tokens INTEGER NOT NULL DEFAULT 0,
     cache_write_tokens INTEGER NOT NULL DEFAULT 0,
     summary TEXT,
     error TEXT
   );
   CREATE TABLE events (
     seq INTEGER PRIMARY KEY AUTOINCREMENT,
     run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
     agent_id TEXT NOT NULL,
     type TEXT NOT NULL,
     at INTEGER NOT NULL,
     data TEXT NOT NULL
   );
   CREATE INDEX events_by_run ON events(run_id, seq);
   CREATE INDEX runs_by_start ON runs(started_at DESC);`,
  `CREATE TABLE projects (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL,
     path TEXT NOT NULL UNIQUE,
     worker_agent TEXT NOT NULL DEFAULT 'claude-code',
     planner_agent TEXT NOT NULL DEFAULT 'claude-code',
     created_at INTEGER NOT NULL
   );
   ALTER TABLE runs ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE CASCADE;
   ALTER TABLE runs ADD COLUMN agent TEXT;
   ALTER TABLE runs ADD COLUMN worktree_path TEXT;
   ALTER TABLE runs ADD COLUMN branch TEXT;
   ALTER TABLE runs ADD COLUMN base_commit TEXT;
   CREATE INDEX runs_by_project ON runs(project_id, started_at DESC);`,
  `ALTER TABLE projects ADD COLUMN actions TEXT;
   ALTER TABLE runs ADD COLUMN settings TEXT;`,
];

/** Saves runs and their events to a local SQLite file. */
export class TraceStore {
  private readonly db: DatabaseSync;

  /** @param file a path, or ":memory:" for tests */
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    // WAL lets the app read a run while the engine is still writing it.
    this.db.exec(
      "PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;",
    );
    this.migrate();
  }

  private migrate(): void {
    const { user_version: version } = this.db.prepare("PRAGMA user_version").get() as unknown as {
      user_version: number;
    };
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec("BEGIN");
      try {
        this.db.exec(MIGRATIONS[v] as string);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  createRun(input: {
    title: string;
    workspace: string;
    model: string;
    id?: string;
    startedAt?: number;
    projectId?: string;
    agent?: AgentId;
    worktree?: { path: string; branch: string; base: string };
    settings?: RunSettings;
  }): string {
    const id = input.id ?? randomUUID();
    this.db
      .prepare(
        `INSERT INTO runs (id, title, workspace, model, started_at, project_id, agent, worktree_path, branch, base_commit, settings)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.title,
        input.workspace,
        input.model,
        input.startedAt ?? Date.now(),
        input.projectId ?? null,
        input.agent ?? null,
        input.worktree?.path ?? null,
        input.worktree?.branch ?? null,
        input.worktree?.base ?? null,
        input.settings ? JSON.stringify(input.settings) : null,
      );
    return id;
  }

  /** Marks a run as failed before any agent event, e.g. when its worktree couldn't be created. */
  failRun(id: string, summary: string, error: string): void {
    this.db
      .prepare(
        "UPDATE runs SET status = 'error', ended_at = ?, summary = ?, error = ? WHERE id = ?",
      )
      .run(Date.now(), summary, error, id);
  }

  addProject(input: {
    name: string;
    path: string;
    workerAgent?: AgentId;
    plannerAgent?: AgentId;
  }): ProjectRecord {
    const existing = this.db
      .prepare("SELECT * FROM projects WHERE path = ?")
      .get(input.path) as unknown as ProjectRow | undefined;
    if (existing) return toProject(existing);
    const id = randomUUID();
    this.db
      .prepare(
        "INSERT INTO projects (id, name, path, worker_agent, planner_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        input.name,
        input.path,
        input.workerAgent ?? "claude-code",
        input.plannerAgent ?? "claude-code",
        Date.now(),
      );
    return this.getProject(id) as ProjectRecord;
  }

  listProjects(): ProjectRecord[] {
    return (
      this.db.prepare("SELECT * FROM projects ORDER BY created_at").all() as unknown as ProjectRow[]
    ).map(toProject);
  }

  getProject(id: string): ProjectRecord | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as unknown as
      ProjectRow | undefined;
    return row && toProject(row);
  }

  updateProjectAgents(id: string, agents: { workerAgent: AgentId; plannerAgent: AgentId }): void {
    this.db
      .prepare("UPDATE projects SET worker_agent = ?, planner_agent = ? WHERE id = ?")
      .run(agents.workerAgent, agents.plannerAgent, id);
  }

  setProjectActions(id: string, actions: ProjectActions): void {
    this.db
      .prepare("UPDATE projects SET actions = ? WHERE id = ?")
      .run(JSON.stringify(actions), id);
  }

  removeProject(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  listProjectRuns(projectId: string, limit = 100): RunRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC LIMIT ?")
        .all(projectId, limit) as unknown as RunRow[]
    ).map(toRun);
  }

  /**
   * Runs still marked "running" when the app starts were cut off when it last
   * closed. Marks them stopped so they don't look stuck or failed.
   */
  closeInterruptedRuns(): number {
    const result = this.db
      .prepare(
        `UPDATE runs SET status = 'cancelled', ended_at = COALESCE(ended_at, ?),
           summary = COALESCE(summary, 'Stopped when helloagents closed.') WHERE status = 'running'`,
      )
      .run(Date.now());
    return Number(result.changes);
  }

  /** Marks a finished run as running again, for a follow-up in the same session. */
  reopenRun(id: string): void {
    this.db
      .prepare("UPDATE runs SET status = 'running', ended_at = NULL, error = NULL WHERE id = ?")
      .run(id);
  }

  /**
   * Appends one event. An agent.end on the main agent also closes the run.
   * Tokens and cost add up, so follow-ups in the same run are counted too.
   */
  record(runId: string, agentId: string, event: AgentEvent): void {
    this.db
      .prepare("INSERT INTO events (run_id, agent_id, type, at, data) VALUES (?, ?, ?, ?, ?)")
      .run(runId, agentId, event.type, event.at, JSON.stringify(event));
    if (event.type === "agent.end" && agentId === "main") {
      this.db
        .prepare(
          `UPDATE runs SET status = ?, ended_at = ?, cost_usd = cost_usd + ?,
             input_tokens = input_tokens + ?, output_tokens = output_tokens + ?,
             cache_read_tokens = cache_read_tokens + ?, cache_write_tokens = cache_write_tokens + ?,
             summary = ?, error = ? WHERE id = ?`,
        )
        .run(
          event.status,
          event.at,
          event.costUsd,
          event.usage.inputTokens,
          event.usage.outputTokens,
          event.usage.cacheReadTokens,
          event.usage.cacheWriteTokens,
          event.summary,
          event.error ?? null,
          runId,
        );
    }
  }

  /** A callback to pass as runAgent's onEvent. */
  recorder(runId: string, agentId = "main"): (event: AgentEvent) => void {
    return (event) => this.record(runId, agentId, event);
  }

  listRuns(limit = 50): RunRecord[] {
    return (
      this.db
        .prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?")
        .all(limit) as unknown as RunRow[]
    ).map(toRun);
  }

  getRun(id: string): RunRecord | undefined {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as unknown as
      RunRow | undefined;
    return row && toRun(row);
  }

  /** Finds a run by id or by a unique id prefix, like git does for commits. */
  findRun(idOrPrefix: string): RunRecord | undefined {
    const rows = this.db
      .prepare("SELECT * FROM runs WHERE id LIKE ? || '%' LIMIT 2")
      .all(idOrPrefix) as unknown as RunRow[];
    return rows.length === 1 ? toRun(rows[0] as RunRow) : undefined;
  }

  events(runId: string, opts: { agentId?: string; afterSeq?: number } = {}): StoredEvent[] {
    const rows = this.db
      .prepare(
        `SELECT seq, run_id, agent_id, data FROM events
         WHERE run_id = ? AND seq > ? AND (? IS NULL OR agent_id = ?) ORDER BY seq`,
      )
      .all(
        runId,
        opts.afterSeq ?? 0,
        opts.agentId ?? null,
        opts.agentId ?? null,
      ) as unknown as EventRow[];
    return rows.map((r) => ({
      seq: r.seq,
      runId: r.run_id,
      agentId: r.agent_id,
      event: JSON.parse(r.data) as AgentEvent,
    }));
  }

  deleteRun(id: string): void {
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(id);
  }

  close(): void {
    this.db.close();
  }
}

interface ProjectRow {
  id: string;
  name: string;
  path: string;
  worker_agent: AgentId;
  planner_agent: AgentId;
  created_at: number;
  actions: string | null;
}

function toProject(r: ProjectRow): ProjectRecord {
  return {
    id: r.id,
    name: r.name,
    path: r.path,
    workerAgent: r.worker_agent,
    plannerAgent: r.planner_agent,
    createdAt: r.created_at,
    actions: r.actions ? (JSON.parse(r.actions) as ProjectActions) : null,
  };
}

interface RunRow {
  id: string;
  title: string;
  workspace: string;
  model: string;
  status: RunStatus;
  started_at: number;
  ended_at: number | null;
  cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
  summary: string | null;
  error: string | null;
  project_id: string | null;
  agent: AgentId | null;
  worktree_path: string | null;
  branch: string | null;
  base_commit: string | null;
  settings: string | null;
}

interface EventRow {
  seq: number;
  run_id: string;
  agent_id: string;
  data: string;
}

function toRun(r: RunRow): RunRecord {
  return {
    id: r.id,
    title: r.title,
    workspace: r.workspace,
    model: r.model,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    costUsd: r.cost_usd,
    usage: {
      inputTokens: r.input_tokens,
      outputTokens: r.output_tokens,
      cacheReadTokens: r.cache_read_tokens,
      cacheWriteTokens: r.cache_write_tokens,
    },
    summary: r.summary,
    error: r.error,
    projectId: r.project_id,
    agent: r.agent,
    worktree:
      r.worktree_path && r.branch && r.base_commit
        ? { path: r.worktree_path, branch: r.branch, base: r.base_commit }
        : null,
    settings: r.settings ? (JSON.parse(r.settings) as RunSettings) : {},
  };
}
