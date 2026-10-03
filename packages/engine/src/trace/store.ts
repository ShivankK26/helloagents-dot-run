import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import type { AgentEvent, AgentStatus, TokenUsage } from "../types";

export type RunStatus = "running" | AgentStatus;

export interface RunRecord {
  id: string;
  title: string;
  workspace: string;
  model: string;
  status: RunStatus;
  startedAt: number;
  endedAt: number | null;
  costUsd: number;
  usage: TokenUsage;
  summary: string | null;
  error: string | null;
}

export interface StoredEvent {
  seq: number;
  runId: string;
  /** Which agent emitted it. A single-agent run uses "main". */
  agentId: string;
  event: AgentEvent;
}

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
  }): string {
    const id = input.id ?? randomUUID();
    this.db
      .prepare("INSERT INTO runs (id, title, workspace, model, started_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, input.title, input.workspace, input.model, input.startedAt ?? Date.now());
    return id;
  }

  /** Appends one event. An agent.end on the main agent also closes the run. */
  record(runId: string, agentId: string, event: AgentEvent): void {
    this.db
      .prepare("INSERT INTO events (run_id, agent_id, type, at, data) VALUES (?, ?, ?, ?, ?)")
      .run(runId, agentId, event.type, event.at, JSON.stringify(event));
    if (event.type === "agent.end" && agentId === "main") {
      this.db
        .prepare(
          `UPDATE runs SET status = ?, ended_at = ?, cost_usd = ?, input_tokens = ?, output_tokens = ?,
             cache_read_tokens = ?, cache_write_tokens = ?, summary = ?, error = ? WHERE id = ?`,
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
  };
}
