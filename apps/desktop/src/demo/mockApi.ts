// A pretend backend for the live demo on helloagents.run: the real app window,
// running in a browser, with sample projects and a scripted agent that "works"
// when you start a task. Nothing touches a real disk, git repo or model.
import { digestRun, toErrors } from "@helloagents/engine/views";
import type { AgentEvent, RunRecord, TokenUsage } from "@helloagents/engine/types";
import type {
  AgentId,
  ErrorListItem,
  HelloagentsApi,
  ProjectActions,
  ProjectRecord,
  RunListItem,
  RunSettings,
  ShipKind,
  StoredEvent,
} from "../shared/api";

interface DemoRun {
  rec: RunRecord;
  events: StoredEvent[];
  diff: string;
  active: boolean;
  dev: boolean;
  timers: number[];
}

interface Step {
  /** Milliseconds after the previous step. */
  wait: number;
  make: (at: number, wait: number) => AgentEvent;
  /** Set when this step ends the agent's turn (the checks may still follow). */
  end?: boolean;
}

const REPO = "https://github.com/ShivankK26/helloagents-dot-run";
const NOT_IN_DEMO =
  "This is the live demo, so it can't reach your Mac. Download the app to try it for real.";
const ZERO: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
const add = (a: TokenUsage, b: TokenUsage): TokenUsage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});
const turnUsage = (out: number): TokenUsage => ({
  inputTokens: 90,
  outputTokens: out,
  cacheReadTokens: 9400,
  cacheWriteTokens: 1300,
});

let seq = 0;
let ids = 0;
const uid = (p: string) => `${p}-${(++ids).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36) || "task";

// ---- Sample data ----

const pnpm: ProjectActions = {
  setup: "pnpm install",
  checks: ["pnpm test", "pnpm typecheck"],
  dev: { command: "pnpm dev", url: "http://localhost:5173" },
  sendBackFailures: true,
};
const go: ProjectActions = {
  setup: null,
  checks: ["go test ./..."],
  dev: null,
  sendBackFailures: true,
};

const ORBIT: ProjectRecord = {
  id: "p-orbit",
  name: "orbit-app",
  path: "~/Code/orbit-app",
  workerAgent: "claude-code",
  plannerAgent: "claude-code",
  createdAt: Date.now() - 9 * 864e5,
  actions: pnpm,
};
const HYDRA: ProjectRecord = {
  id: "p-hydra",
  name: "HydraDB",
  path: "~/Code/HydraDB",
  workerAgent: "claude-code",
  plannerAgent: "claude-code",
  createdAt: Date.now() - 5 * 864e5,
  actions: go,
};
const ACME: ProjectRecord = {
  id: "p-acme",
  name: "acme-web",
  path: "~/Code/acme-web",
  workerAgent: "claude-code",
  plannerAgent: "claude-code",
  createdAt: Date.now() - 3 * 864e5,
  actions: {
    setup: "pnpm install",
    checks: ["pnpm test", "pnpm lint"],
    dev: { command: "pnpm dev", url: "http://localhost:3000" },
    sendBackFailures: true,
  },
};
const projects: ProjectRecord[] = [ORBIT, HYDRA, ACME];
const runs = new Map<string, DemoRun>();
const changed = new Set<(id: string) => void>();
const opened = new Set<(id: string) => void>();
const notify = (id: string) => changed.forEach((l) => l(id));

// ---- Scripts: what the pretend agent does ----

/** The last step ends the agent's turn. */
function markEnd(steps: Step[]): void {
  const last = steps.at(-1);
  if (last) last.end = true;
}

const projectOf = (run: DemoRun): ProjectRecord =>
  projects.find((p) => p.id === run.rec.projectId) ?? ORBIT;

const QUESTION =
  /^(what|how|why|where|which|who|explain|tell|describe|summari[sz]e|walk|show)\b|\?\s*$/i;

const STOP = new Set(
  "add fix make create update implement refactor rename remove the a an to at of in on for with and or per most least each every all our its it this that from into by as be is are when then than so up out new".split(
    " ",
  ),
);

/** One or two meaningful words from the task, for believable file names. */
function topic(task: string): string {
  const words = task.toLowerCase().match(/[a-z]+/g) ?? [];
  const keep = words.filter((w) => w.length > 2 && !STOP.has(w)).slice(0, 2);
  return keep.join("-") || "change";
}

function filesFor(task: string, project: ProjectRecord) {
  const s = topic(task);
  const ext = project.actions === go ? "go" : "ts";
  const src =
    project.actions === go
      ? `internal/${s.split("-")[0]}/${s.replace(/-/g, "_")}.go`
      : `src/${s}.ts`;
  const test = project.actions === go ? src.replace(/\.go$/, "_test.go") : `test/${s}.test.ts`;
  return { src, test, ext };
}

function diffFor(task: string, project: ProjectRecord): string {
  const { src, test } = filesFor(task, project);
  const fn = topic(task)
    .split("-")
    .map((w, i) => (i ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join("");
  return [
    `diff --git a/${src} b/${src}`,
    `--- a/${src}`,
    `+++ b/${src}`,
    "@@ -1,8 +1,16 @@",
    ' import { config } from "./config";',
    '+import { RateLimiter } from "./limits";',
    " ",
    `-export async function ${fn}(input) {`,
    `-  return handle(input);`,
    `+// ${task}`,
    `+export async function ${fn}(input) {`,
    "+  if (!input) {",
    '+    throw new Error("Nothing to work with.");',
    "+  }",
    "+  const result = await handle(input);",
    '+  log.info({ step: "done", id: result.id });',
    "+  return result;",
    " }",
    `diff --git a/${test} b/${test}`,
    "new file mode 100644",
    "--- /dev/null",
    `+++ b/${test}`,
    "@@ -0,0 +1,9 @@",
    `+import { ${fn} } from "../${src.replace(/\.ts$/, "")}";`,
    "+",
    `+test("${task.slice(0, 50)}", async () => {`,
    `+  const result = await ${fn}({ id: 1 });`,
    "+  expect(result.id).toBe(1);",
    "+});",
    "+",
    `+test("rejects empty input", async () => {`,
    `+  await expect(${fn}(undefined)).rejects.toThrow();`,
    "+});",
  ].join("\n");
}

function script(
  task: string,
  project: ProjectRecord,
  opts: { failChecks?: boolean; followUp?: boolean } = {},
): Step[] {
  const steps: Step[] = [];
  let turn = 0;
  let calls = 0;
  const say = (
    wait: number,
    text: string,
    tools: Array<{ name: string; input: unknown }> = [],
    out = 260,
  ): void => {
    turn++;
    const t = turn;
    const toolCalls = tools.map((x) => ({ id: `c${++calls}`, ...x }));
    steps.push({
      wait,
      make: (at, w) => ({
        type: "model.response",
        at,
        turn: t,
        durationMs: w,
        model: "claude-opus-5-5",
        stopReason: toolCalls.length ? "tool_use" : "end_turn",
        text,
        toolCalls,
        usage: turnUsage(out),
        costUsd: 0.04,
      }),
    });
    for (const c of toolCalls) {
      const { output, ok, took } = toolResult(c.name, c.input, project, opts);
      steps.push({
        wait: took,
        make: (at, w) => ({
          type: "tool.result",
          at,
          turn: t,
          id: c.id,
          name: c.name,
          input: c.input,
          ok,
          output,
          durationMs: w,
        }),
      });
    }
  };
  const { src, test } = filesFor(task, project);

  if (!opts.followUp && QUESTION.test(task.trim())) {
    say(1400, "Let me look around the code first.", [
      { name: "Glob", input: { pattern: "**/*.{ts,go,md}" } },
      { name: "Read", input: { file_path: "README.md" } },
      {
        name: "Read",
        input: { file_path: project.actions === go ? "cmd/server/main.go" : "src/index.ts" },
      },
      { name: "Bash", input: { command: "git log --oneline -8" } },
    ]);
    say(2600, answerFor(task, project), [], 520);
    markEnd(steps);
    return steps;
  }

  say(
    1100,
    opts.followUp
      ? "On it. I'll make that change on the same branch."
      : "I'll find where this lives, make the change, and cover it with a test.",
    [
      { name: "Read", input: { file_path: src } },
      { name: "Read", input: { file_path: project.actions === go ? "go.mod" : "package.json" } },
      { name: "Grep", input: { pattern: slug(task).split("-")[0] ?? "todo" } },
    ],
  );
  say(2200, "", [
    {
      name: "Edit",
      input: {
        file_path: src,
        old_string: "export async function run(input) {\n  return handle(input);",
        new_string:
          'export async function run(input) {\n  if (!input) {\n    throw new Error("Nothing to work with.");\n  }\n  const result = await handle(input);\n  log.info({ step: "done" });\n  return result;',
      },
    },
  ]);
  say(900, "", [
    { name: "Write", input: { file_path: test, content: "a\nb\nc\nd\ne\nf\ng\nh\ni\n" } },
  ]);
  say(700, "Running the tests to make sure nothing else broke.", [
    { name: "Bash", input: { command: project.actions === go ? "go test ./..." : "pnpm test" } },
  ]);
  say(
    1500,
    opts.failChecks
      ? "I updated the date handling. One test still looks unrelated to my change; the checks will tell."
      : `Done. ${task.replace(/\.$/, "")}: the change is in \`${src}\`, with tests in \`${test}\`. All tests pass.`,
    [],
    180,
  );
  markEnd(steps);
  return steps;
}

function toolResult(
  name: string,
  input: unknown,
  project: ProjectRecord,
  opts: { failChecks?: boolean },
) {
  const i = (input ?? {}) as Record<string, string>;
  if (name === "Bash") {
    const cmd = i.command ?? "";
    if (/test/.test(cmd)) {
      return opts.failChecks
        ? {
            ok: false,
            took: 3800,
            output:
              '✓ formatDate › formats ISO dates\n✗ formatDate › handles the DST change\n  Expected: "2026-03-29 02:30"\n  Received: "2026-03-29 03:30"\nTests  1 failed | 13 passed (14)',
          }
        : {
            ok: true,
            took: 3600,
            output:
              "✓ accepts valid input\n✓ rejects empty input\n✓ keeps existing behaviour\nTests  14 passed (14)",
          };
    }
    return {
      ok: true,
      took: 300,
      output:
        "a41c09e Add shared albums\n7d2e1f0 Resize uploads on the server\n3c9b2aa Initial commit",
    };
  }
  if (name === "Edit" || name === "Write") return { ok: true, took: 200, output: "Updated." };
  if (name === "Glob")
    return { ok: true, took: 150, output: "README.md\nsrc/index.ts\nsrc/billing.ts" };
  return { ok: true, took: 180, output: project.name };
}

function answerFor(task: string, project: ProjectRecord): string {
  if (/slow|speed|fast/i.test(task)) {
    return [
      "**The integration tests are slow because each one starts a fresh database.**",
      "",
      "## Where the time goes",
      "- `testutil.NewDB()` runs all 48 migrations for every test: about 1.9s each, 71 tests.",
      "- Three tests sleep for 2s waiting on the background compactor.",
      "",
      "## What I'd change",
      "1. Migrate once per package and wrap each test in a transaction that rolls back.",
      "2. Replace the sleeps with a `compactor.Flush()` hook.",
      "",
      "Together that should take the suite from about 2m 40s to under 30s.",
    ].join("\n");
  }
  if (/deploy|hosting|release/i.test(task)) {
    return [
      `**${project.name} deploys to Vercel** on every push to \`main\`; pull requests get preview URLs.`,
      "",
      "## The blog specifically",
      "- Posts are MDX files in `content/blog/`, built statically at deploy time.",
      "- A nightly cron revalidates the index so scheduled posts appear on their date.",
      "",
      "## Worth knowing",
      "- Images go through `next/image` with the Vercel loader; large GIFs are skipped.",
      "- There's no staging branch: previews are the staging step.",
    ].join("\n");
  }
  if (/billing|pay|price|plan/i.test(task)) {
    return [
      `**Billing in ${project.name}** runs through Stripe, with plans defined in \`src/billing/plans.ts\`.`,
      "",
      "## How it works",
      "1. Checkout creates a Stripe session for the chosen plan.",
      "2. A webhook (`/api/stripe/webhook`) marks the team as paid and stores the period end.",
      "3. Usage is counted per upload and checked against the plan's monthly limit.",
      "",
      "## Worth knowing",
      "- Failed uploads don't count toward usage.",
      "- There's no proration yet: upgrades take effect at the next period.",
    ].join("\n");
  }
  return [
    `**${project.name}** is organised around a small core with clear edges.`,
    "",
    "## The short version",
    `- Entry point: \`${project.actions === go ? "cmd/server/main.go" : "src/index.ts"}\`.`,
    "- Business logic lives in one folder per feature; each has its own tests.",
    "- Configuration comes from environment variables, validated at start-up.",
    "",
    `For “${task.replace(/\?$/, "")}”, start with the README, then the entry point above.`,
  ].join("\n");
}

// ---- Running scripts ----

function newRun(
  project: ProjectRecord,
  task: string,
  settings: RunSettings,
  startedAt: number,
): DemoRun {
  const branch = `helloagents/${uid("").slice(1, 7)}-${slug(task).slice(0, 28)}`;
  const run: DemoRun = {
    rec: {
      id: uid("run"),
      title: task,
      workspace: `~/Library/helloagents/worktrees/${branch.split("/")[1]}`,
      model: settings.model || "claude-opus-5-5",
      status: "running",
      startedAt,
      endedAt: null,
      costUsd: 0,
      usage: ZERO,
      summary: null,
      error: null,
      projectId: project.id,
      agent: project.workerAgent,
      worktree: {
        path: `~/Library/helloagents/worktrees/${branch.split("/")[1]}`,
        branch,
        base: "a41c09e",
      },
      settings: { ...settings, baseBranch: "main" },
    },
    events: [],
    diff: "",
    active: true,
    dev: false,
    timers: [],
  };
  runs.set(run.rec.id, run);
  return run;
}

function push(run: DemoRun, event: AgentEvent): void {
  run.events.push({ seq: ++seq, runId: run.rec.id, agentId: "main", event });
  if (event.type === "model.response") {
    run.rec.usage = add(run.rec.usage, event.usage);
    run.rec.costUsd += event.costUsd;
  }
  if (event.type === "agent.end") {
    run.rec.status = event.status;
    run.rec.endedAt = event.at;
    run.rec.summary = event.summary;
  }
}

function checksEvent(project: ProjectRecord, at: number, fail: boolean, took: number): AgentEvent {
  const cmds = project.actions?.checks ?? [];
  return {
    type: "tool.result",
    at,
    turn: 0,
    id: uid("checks"),
    name: "checks",
    input: { commands: cmds },
    ok: !fail,
    output: fail
      ? project === ACME
        ? `$ ${cmds[0]}\n✗ pricing › renders the plans table\n  TypeError: unstable_cache is not a function\n    at lib/plans.ts:12\nTests  1 failed | 22 passed (23)\n(exit code 1)`
        : `$ ${cmds[0]}\n✗ formatDate › handles the DST change\nTests  1 failed | 13 passed (14)\n(exit code 1)`
      : cmds
          .map((c) => `$ ${c}\n${/test/.test(c) ? "Tests  14 passed (14)" : "Done in 2.1s"}`)
          .join("\n\n"),
    durationMs: took,
  };
}

/** Plays a script into a run, either instantly (seeding) or live with real pauses. */
function play(
  run: DemoRun,
  task: string,
  steps: Step[],
  opts: { live: boolean; failChecks?: boolean; startAt?: number },
) {
  const project = projectOf(run);
  let clock = opts.startAt ?? Date.now();
  const timeline: Array<{
    wait: number;
    ev: (at: number, w: number) => AgentEvent | null;
    last?: boolean;
  }> = [
    {
      wait: 0,
      ev: (at) => ({
        type: "agent.start",
        at,
        task,
        model: run.rec.model,
        workspace: run.rec.workspace,
        sessionId: "demo-session",
      }),
    },
  ];
  for (const s of steps) {
    timeline.push({ wait: s.wait, ev: s.make });
    if (s.end) {
      timeline.push({
        wait: 200,
        ev: (at) => {
          // Like Claude Code, the summary is the agent's last message in this turn.
          const said = run.events.flatMap((e) =>
            e.event.type === "model.response" && e.event.text ? [e.event.text] : [],
          );
          return {
            type: "agent.end",
            at,
            status: "done",
            summary: said.at(-1) ?? "Done.",
            turns: run.events.filter((e) => e.event.type === "model.response").length,
            usage: run.rec.usage,
            costUsd: run.rec.costUsd,
            sessionId: "demo-session",
          };
        },
      });
    }
  }
  const changes = steps.some(
    (x) =>
      x.make(0, 0).type === "tool.result" &&
      ["Edit", "Write"].includes((x.make(0, 0) as { name: string }).name),
  );
  if (project.actions?.checks.length && changes) {
    timeline.push({
      wait: 2400,
      ev: (at, w) => checksEvent(project, at, Boolean(opts.failChecks), w),
    });
  }
  const final = timeline.at(-1);
  if (final) final.last = true;

  const apply = (t: (typeof timeline)[number], at: number) => {
    const ev = t.ev(at, t.wait);
    if (ev) push(run, ev);
    if (ev?.type === "tool.result" && ev.name === "Edit")
      run.diff = diffFor(run.rec.title, project);
    if (t.last) run.active = false;
    notify(run.rec.id);
  };

  if (!opts.live) {
    for (const t of timeline) {
      clock += t.wait;
      apply(t, clock);
    }
    return;
  }
  let delay = 0;
  for (const t of timeline) {
    delay += t.wait;
    run.timers.push(window.setTimeout(() => apply(t, Date.now()), delay));
  }
}

function stop(run: DemoRun): void {
  run.timers.forEach((t) => clearTimeout(t));
  run.timers = [];
  if (!run.active) return;
  run.active = false;
  push(run, {
    type: "agent.end",
    at: Date.now(),
    status: "cancelled",
    summary: "Stopped.",
    turns: run.events.filter((e) => e.event.type === "model.response").length,
    usage: run.rec.usage,
    costUsd: run.rec.costUsd,
  });
  notify(run.rec.id);
}

function startLive(project: ProjectRecord, task: string, settings: RunSettings = {}): string {
  const run = newRun(project, task, settings, Date.now());
  notify(run.rec.id);
  play(run, task, script(task, project), { live: true });
  return run.rec.id;
}

function continueLive(run: DemoRun, message: string): void {
  const project = projectOf(run);
  run.timers.forEach((t) => clearTimeout(t));
  run.timers = [];
  run.active = true;
  run.rec.status = "running";
  run.rec.endedAt = null;
  notify(run.rec.id);
  play(run, message, script(message, project, { followUp: true }), { live: true });
}

// ---- Seed the sample history ----

function seed(): void {
  const ago = (min: number) => Date.now() - min * 60_000;
  const done = (p: ProjectRecord, task: string, startedMin: number, fail = false) => {
    const run = newRun(p, task, {}, ago(startedMin));
    play(run, task, script(task, p, { failChecks: fail }), {
      live: false,
      failChecks: fail,
      startAt: ago(startedMin),
    });
  };
  /** A run someone stopped partway: it read the code, then was cancelled. */
  const stopped = (p: ProjectRecord, task: string, startedMin: number) => {
    const run = newRun(p, task, {}, ago(startedMin));
    play(run, task, script(task, p).slice(0, 4), { live: false, startAt: ago(startedMin) });
    push(run, {
      type: "agent.end",
      at: ago(startedMin) + 9000,
      status: "cancelled",
      summary: "Stopped.",
      turns: 1,
      usage: run.rec.usage,
      costUsd: run.rec.costUsd,
    });
    run.active = false;
  };
  // Oldest first, so the newest ends up on top.
  done(HYDRA, "Add retries to the S3 uploader", 2900);
  done(HYDRA, "Rename user to account across the API", 1500);
  done(ACME, "How is the blog deployed?", 1000);
  stopped(ORBIT, "Cache photo thumbnails", 900);
  done(ACME, "Add an FAQ section to the pricing page", 600);
  done(ORBIT, "Add dark mode to the settings page", 400);
  done(HYDRA, "Why are the integration tests slow?", 200);
  done(HYDRA, "Fix the failing date tests", 120, true);
  done(ORBIT, "Explain how billing works", 70);
  done(ACME, "Upgrade to Next.js 16", 35, true);
}

// ---- The API the app window talks to ----

const listItem = (r: DemoRun): RunListItem => ({
  ...r.rec,
  active: r.active,
  devRunning: r.dev,
  branchGone: false,
  digest: digestRun(r.events),
});
const byNewest = () => [...runs.values()].sort((a, b) => b.rec.startedAt - a.rec.startedAt);
const need = (id: string) => {
  const r = runs.get(id);
  if (!r) throw new Error("That run doesn't exist.");
  return r;
};
const later = <T>(v: T, ms = 120): Promise<T> => new Promise((res) => setTimeout(() => res(v), ms));
const fail = (msg = NOT_IN_DEMO) => Promise.reject(new Error(msg));

export const demoApi: HelloagentsApi = {
  getInfo: async () => ({
    appVersion: "0.2.3",
    engineVersion: "0.2.3",
    electron: "demo",
    platform: "darwin",
    claudeCode: { installed: true, version: "2.1.289" },
    hasApiKey: false,
  }),
  detectAgents: async () => [
    {
      id: "claude-code",
      name: "Claude Code",
      installed: true,
      version: "2.1.289",
      billing: "Uses your Claude Pro or Max plan",
      installHint: "",
    },
    {
      id: "codex",
      name: "Codex CLI",
      installed: false,
      billing: "Uses your ChatGPT plan",
      installHint: "Coming soon to helloagents.",
    },
  ],
  chooseFolder: async () => "~/Code/my-app",
  inspectFolder: async (path) => ({
    path,
    name: path.split("/").pop() ?? "my-app",
    isRepo: true,
    hasCommits: true,
    childRepos: [],
  }),
  cloneRepo: async (url) =>
    `~/Code/${
      url
        .replace(/\.git$/, "")
        .split(/[/:]/)
        .pop() || "repo"
    }`,
  listProjects: async () => [...projects],
  addProject: async (input) => {
    const existing = projects.find((p) => p.path === input.path);
    if (existing) return existing;
    const p: ProjectRecord = { id: uid("p"), createdAt: Date.now(), actions: pnpm, ...input };
    projects.push(p);
    return p;
  },
  updateProjectAgents: async (id, a) => {
    const p = projects.find((x) => x.id === id);
    if (p) Object.assign(p, a);
  },
  removeProject: async (id) => {
    const i = projects.findIndex((p) => p.id === id);
    if (i >= 0) projects.splice(i, 1);
  },
  listRuns: async (projectId) =>
    byNewest()
      .filter((r) => r.rec.projectId === projectId)
      .map(listItem),
  listAllRuns: async (limit = 100) => byNewest().slice(0, limit).map(listItem),
  listErrors: async () =>
    byNewest()
      .flatMap((r) =>
        toErrors(r.events).map((e): ErrorListItem => ({
          ...e,
          runId: r.rec.id,
          runTitle: r.rec.title,
          projectId: r.rec.projectId,
        })),
      )
      .sort((a, b) => b.at - a.at),
  getRun: async (id) => {
    const r = runs.get(id);
    return r ? listItem(r) : null;
  },
  startRun: async (projectId, task, settings) => {
    const p = projects.find((x) => x.id === projectId);
    if (!p) throw new Error("That project no longer exists.");
    if (p.workerAgent !== "claude-code") throw new Error("Only Claude Code runs in the demo.");
    return later(startLive(p, task, settings ?? {}), 300);
  },
  projectInfo: async (projectId) => ({
    branch: "main",
    head: "a41c09e",
    branches: ["main", "release/0.9", "feat/albums"],
    actions: projects.find((p) => p.id === projectId)?.actions ?? pnpm,
  }),
  setProjectActions: async (projectId, actions) => {
    const p = projects.find((x) => x.id === projectId);
    if (p) p.actions = actions;
  },
  detectActions: async () => pnpm,
  resumeRun: async (id) => continueLive(need(id), "Continue where you left off."),
  runChecks: async (id) => {
    const r = need(id);
    const p = projectOf(r);
    r.active = true;
    notify(id);
    r.timers.push(
      window.setTimeout(() => {
        push(r, checksEvent(p, Date.now(), false, 2600));
        r.active = false;
        notify(id);
      }, 2600),
    );
  },
  ship: async (id, kind: ShipKind) => {
    const r = need(id);
    const branch = r.rec.worktree?.branch ?? "";
    await later(null, 700);
    if (kind === "commit") return { message: `Committed 4f9c2ab on ${branch} (demo)` };
    if (kind === "push") return { message: `Pushed ${branch} (demo)` };
    if (kind === "pr")
      return { message: "Opened a pull request (demo: nothing was pushed)", url: REPO };
    return { message: "Merged into main (demo)" };
  },
  startDev: async (id) => {
    need(id).dev = true;
    notify(id);
    return "http://localhost:5173";
  },
  stopDev: async (id) => {
    need(id).dev = false;
    notify(id);
  },
  listOpeners: async () => [
    { id: "zed", name: "Zed" },
    { id: "cursor", name: "Cursor" },
    { id: "vscode", name: "VS Code" },
    { id: "finder", name: "Finder" },
    { id: "terminal", name: "Terminal" },
  ],
  openIn: () => fail(),
  setTheme: async () => undefined,
  followUp: async (id, message) => continueLive(need(id), message),
  cancelRun: async (id) => stop(need(id)),
  discardRun: async (id) => {
    const r = need(id);
    stop(r);
    runs.delete(id);
    notify(id);
  },
  runEvents: async (id, afterSeq) => (runs.get(id)?.events ?? []).filter((e) => e.seq > afterSeq),
  runDiff: async (id) => later(runs.get(id)?.diff ?? ""),
  revealInFinder: () => fail(),
  openExternal: async (url) => {
    if (/^https?:\/\//.test(url)) window.open(url, "_blank", "noopener");
  },
  onRunChanged: (l) => {
    changed.add(l);
    return () => changed.delete(l);
  },
  onOpenRun: (l) => {
    opened.add(l);
    return () => opened.delete(l);
  },
};

/** Fills in the history, then starts two runs so the demo opens on live work. */
export function startDemo(): void {
  seed();
  window.setTimeout(() => {
    startLive(HYDRA, "Paginate the audit log API", { model: "claude-sonnet-5" });
    const id = startLive(ORBIT, "Add rate limiting to uploads: at most 10 a minute per user", {
      model: "claude-opus-5-5",
      effort: "high",
    });
    opened.forEach((l) => l(id));
  }, 900);
}

export type { AgentId };
