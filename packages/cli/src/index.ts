import { cp, mkdir, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  AnthropicModel,
  DEFAULT_MODEL,
  runAgent,
  type AgentEvent,
  type Effort,
} from "@helloagents/engine";

const USAGE = `Usage:
  helloagents agent "<task>" [options]

Options:
  --dir <path>        Project to work in (default: current folder)
  --copy              Work on a copy of the project, leaving the original untouched
  --model <id>        Default ${DEFAULT_MODEL}
  --effort <level>    low | medium | high | xhigh | max (default high)
  --max-turns <n>     Default 40
  --max-cost <usd>    Default 5

Needs ANTHROPIC_API_KEY (or an \`ant auth login\` profile).`;

// pnpm runs scripts from the package folder; resolve paths from where the user typed the command.
const cwd = process.env.INIT_CWD ?? process.cwd();
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: number) => (s: string) => (tty ? `\x1b[${code}m${s}\x1b[0m` : s);
const dim = c(2),
  green = c(32),
  red = c(31),
  yellow = c(33),
  bold = c(1);

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
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, ...rest] = positionals;
  const task = rest.join(" ").trim();
  if (values.help || command !== "agent" || !task) {
    console.log(USAGE);
    return command === "agent" || values.help ? 0 : 2;
  }

  const source = path.resolve(cwd, values.dir ?? ".");
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const dataDir = path.join(cwd, ".helloagents");
  let workspace = source;
  if (values.copy) {
    workspace = path.join(dataDir, "scratch", runId);
    await cp(source, workspace, {
      recursive: true,
      filter: (p) => !p.includes(`${path.sep}node_modules`) && !p.includes(`${path.sep}.git`),
    });
  }

  // Every event is also saved as one JSON line: a first, simple trace.
  const traceFile = path.join(dataDir, "runs", `${runId}.jsonl`);
  await mkdir(path.dirname(traceFile), { recursive: true });
  await writeFile(traceFile, "");

  const model = new AnthropicModel({
    model: values.model ?? DEFAULT_MODEL,
    effort: (values.effort as Effort) ?? "high",
  });
  const controller = new AbortController();
  process.once("SIGINT", () => {
    console.log(yellow("\nStopping after the current step…"));
    controller.abort();
  });

  console.log(
    `${bold("helloagents agent")} ${dim(`· ${model.model} · ${workspace}${values.copy ? " (copy)" : ""}`)}\n`,
  );
  const started = Date.now();
  const result = await runAgent({
    task,
    workspace,
    model,
    maxTurns: Number(values["max-turns"] ?? 40),
    maxCostUsd: Number(values["max-cost"] ?? 5),
    signal: controller.signal,
    onEvent: (event) => {
      void appendFile(traceFile, `${JSON.stringify(event)}\n`);
      print(event);
    },
  });

  const secs = Math.round((Date.now() - started) / 1000);
  const tokens =
    result.usage.inputTokens +
    result.usage.outputTokens +
    result.usage.cacheReadTokens +
    result.usage.cacheWriteTokens;
  const line = `${result.turns} turn${result.turns === 1 ? "" : "s"} · ${(tokens / 1000).toFixed(1)}k tokens · $${result.costUsd.toFixed(2)} · ${secs}s`;
  console.log("");
  if (result.status === "done") console.log(`${green("✔ done")} ${dim(line)}\n\n${result.summary}`);
  else {
    console.log(
      `${red(`✖ ${result.status}`)} ${dim(line)}\n${result.summary}${result.error ? `\n${red(result.error)}` : ""}`,
    );
    if (result.error && /auth|api key|credential/i.test(result.error)) {
      console.log(
        dim(
          "\nSet ANTHROPIC_API_KEY (from https://platform.claude.com) or run `ant auth login`, then try again.",
        ),
      );
    }
  }
  console.log(
    dim(
      `\nTrace: ${path.relative(cwd, traceFile)}${values.copy ? `\nChanged copy: ${path.relative(cwd, workspace)}` : ""}`,
    ),
  );
  return result.status === "done" ? 0 : 1;
}

function print(event: AgentEvent): void {
  if (event.type === "model.response" && event.text) {
    console.log(
      event.text
        .split("\n")
        .map((l) => `${dim("│")} ${l}`)
        .join("\n"),
    );
  }
  if (event.type === "tool.result") {
    const input = event.input as Record<string, unknown>;
    const detail =
      event.name === "run_command"
        ? [input.command, ...((input.args as string[]) ?? [])].join(" ")
        : String(input.path ?? (event.name === "finish" ? "" : "."));
    const firstLine = event.output.split("\n")[0] ?? "";
    const mark = event.ok ? green("✓") : red("✗");
    console.log(`  ${mark} ${event.name} ${dim(detail)}${event.ok ? "" : ` ${red(firstLine)}`}`);
  }
}

process.exitCode = await main();
