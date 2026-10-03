import { cp } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  AnthropicModel,
  DEFAULT_MODEL,
  runAgent,
  toErrors,
  toLogLines,
  TraceStore,
  type AgentEvent,
  type Effort,
  type ModelClient,
} from "@helloagents/engine";
import { DEMO_TASK, demoModel } from "./demo";

const USAGE = `Usage:
  helloagents agent "<task>" [options]   Run one agent on a task
  helloagents runs                       List recent runs
  helloagents trace <run-id> [--errors]  Show what happened in a run
  helloagents demo                       Watch a free, scripted run fix the sample project

Agent options:
  --dir <path>        Project to work in (default: current folder)
  --copy              Work on a copy of the project, leaving the original untouched
  --model <id>        Default ${DEFAULT_MODEL}
  --effort <level>    low | medium | high | xhigh | max (default high)
  --max-turns <n>     Default 40
  --max-cost <usd>    Default 5

Running an agent needs ANTHROPIC_API_KEY (or an \`ant auth login\` profile).`;

// pnpm runs scripts from the package folder; resolve paths from where the user typed the command.
const cwd = process.env.INIT_CWD ?? process.cwd();
const tty = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const color = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = color(2);
const green = color(32);
const red = color(31);
const yellow = color(33);
const bold = color(1);

interface AgentFlags {
  dir?: string;
  copy?: boolean;
  model?: string;
  effort?: string;
  "max-turns"?: string;
  "max-cost"?: string;
}

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      dir: { type: "string" },
      copy: { type: "boolean" },
      model: { type: "string" },
      effort: { type: "string" },
      "max-turns": { type: "string" },
      "max-cost": { type: "string" },
      errors: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const dataDir = path.join(cwd, ".helloagents");
  const store = new TraceStore(path.join(dataDir, "helloagents.db"));
  try {
    switch (command) {
      case "agent":
        return await agent(store, dataDir, rest.join(" ").trim(), values);
      case "runs":
        return listRuns(store);
      case "trace":
        return showTrace(store, rest[0], Boolean(values.errors));
      case "demo": {
        const sample = fileURLToPath(new URL("../../../examples/buggy-stats", import.meta.url));
        return await agent(store, dataDir, DEMO_TASK, { dir: sample, copy: true }, demoModel());
      }
      default:
        console.error(`Unknown command "${command}".\n\n${USAGE}`);
        return 2;
    }
  } finally {
    store.close();
  }
}

async function agent(
  store: TraceStore,
  dataDir: string,
  task: string,
  flags: AgentFlags,
  scripted?: ModelClient,
): Promise<number> {
  if (!task) {
    console.error(`Give the agent a task, e.g. pnpm agent "fix the failing tests"\n\n${USAGE}`);
    return 2;
  }
  const source = path.resolve(cwd, flags.dir ?? ".");
  let workspace = source;
  if (flags.copy) {
    workspace = path.join(dataDir, "scratch", new Date().toISOString().replace(/[:.]/g, "-"));
    await cp(source, workspace, {
      recursive: true,
      filter: (p) => !p.includes(`${path.sep}node_modules`) && !p.includes(`${path.sep}.git`),
    });
  }

  const model =
    scripted ??
    new AnthropicModel({
      model: flags.model ?? DEFAULT_MODEL,
      effort: (flags.effort as Effort | undefined) ?? "high",
    });
  const modelLabel = scripted ? "scripted demo (no API calls)" : model.model;
  const runId = store.createRun({ title: task, workspace, model: modelLabel });
  const record = store.recorder(runId);

  const controller = new AbortController();
  process.once("SIGINT", () => {
    console.log(yellow("\nStopping after the current step…"));
    controller.abort();
  });

  console.log(
    `${bold("helloagents agent")} ${dim(`· ${modelLabel} · ${workspace}${flags.copy ? " (copy)" : ""}`)}\n`,
  );
  const started = Date.now();
  const result = await runAgent({
    task,
    workspace,
    model,
    maxTurns: Number(flags["max-turns"] ?? 40),
    maxCostUsd: Number(flags["max-cost"] ?? 5),
    signal: controller.signal,
    onEvent: (event) => {
      record(event);
      printLive(event);
    },
  });

  const secs = Math.round((Date.now() - started) / 1000);
  const u = result.usage;
  const tokens = u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  const stats = `${result.turns} turn${result.turns === 1 ? "" : "s"} · ${(tokens / 1000).toFixed(1)}k tokens · $${result.costUsd.toFixed(2)} · ${secs}s`;
  console.log("");
  if (result.status === "done") {
    console.log(`${green("✔ done")} ${dim(stats)}\n\n${result.summary}`);
  } else {
    console.log(
      `${red(`✖ ${result.status}`)} ${dim(stats)}\n${result.summary}${result.error ? `\n${red(result.error)}` : ""}`,
    );
    if (result.error && /auth|api key|credential/i.test(result.error)) {
      console.log(
        dim(
          "\nSet ANTHROPIC_API_KEY (from https://platform.claude.com) or run `ant auth login`, then try again.",
        ),
      );
    }
  }
  console.log(dim(`\nFull trace: pnpm helloagents trace ${runId.slice(0, 8)}`));
  if (flags.copy) console.log(dim(`Changed copy: ${path.relative(cwd, workspace)}`));
  return result.status === "done" ? 0 : 1;
}

function printLive(event: AgentEvent): void {
  if (event.type === "model.response" && event.text) {
    console.log(
      event.text
        .split("\n")
        .map((l) => `${dim("│")} ${l}`)
        .join("\n"),
    );
  }
  if (event.type === "tool.result") {
    const input = (event.input ?? {}) as Record<string, unknown>;
    const detail =
      event.name === "run_command"
        ? [input.command, ...((input.args as string[] | undefined) ?? [])].join(" ")
        : event.name === "finish"
          ? ""
          : String(input.path ?? ".");
    const firstLine = event.output.split("\n")[0] ?? "";
    console.log(
      `  ${event.ok ? green("✓") : red("✗")} ${event.name} ${dim(detail)}${event.ok ? "" : ` ${red(firstLine)}`}`,
    );
  }
}

const STATUS_COLOR: Record<string, (s: string) => string> = {
  done: green,
  running: yellow,
  cancelled: yellow,
  budget: yellow,
};

function ago(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  return `${Math.round(minutes / 1440)}d ago`;
}

function clock(ms: number): string {
  return `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;
}

function listRuns(store: TraceStore): number {
  const runs = store.listRuns(20);
  if (runs.length === 0) {
    console.log('No runs yet. Start one with: pnpm agent "<task>"');
    return 0;
  }
  for (const r of runs) {
    const paint = STATUS_COLOR[r.status] ?? red;
    console.log(
      `${dim(r.id.slice(0, 8))}  ${paint(r.status.padEnd(9))} ${r.title.slice(0, 60).padEnd(60)} ${dim(`$${r.costUsd.toFixed(2)} · ${ago(r.startedAt)}`)}`,
    );
  }
  return 0;
}

function showTrace(store: TraceStore, id: string | undefined, errorsOnly: boolean): number {
  const run = id ? store.findRun(id) : undefined;
  if (!run) {
    console.error(
      id
        ? `No run matches "${id}". List runs with: pnpm helloagents runs`
        : "Usage: helloagents trace <run-id>",
    );
    return 1;
  }
  const events = store.events(run.id);
  console.log(
    `${bold(run.title)}\n${dim(`${run.id} · ${run.model} · ${run.status} · $${run.costUsd.toFixed(2)}`)}\n`,
  );
  if (!errorsOnly) {
    for (const line of toLogLines(events)) {
      const level =
        line.level === "ERROR"
          ? red("ERROR")
          : line.level === "WARN"
            ? yellow("WARN ")
            : dim("INFO ");
      console.log(`${dim(clock(line.at - run.startedAt))}  ${level}  ${line.message}`);
    }
  }
  const errors = toErrors(events);
  if (errors.length)
    console.log(`\n${bold(`${errors.length} error${errors.length === 1 ? "" : "s"}`)}`);
  for (const e of errors)
    console.log(`\n${red(e.title)} ${dim(`at ${clock(e.at - run.startedAt)}`)}\n${e.excerpt}`);
  if (run.summary) console.log(`\n${bold("Summary")}\n${run.summary}`);
  return 0;
}

process.exitCode = await main();
