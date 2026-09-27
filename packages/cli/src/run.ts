import { parseArgs } from "node:util";
import { add } from "./commands/add.js";
import { list } from "./commands/list.js";
import { remove } from "./commands/remove.js";
import { search } from "./commands/search.js";
import type { Io } from "./io.js";
import { CliError, createStyle } from "./output.js";
import { DEFAULT_REGISTRY_URL, REGISTRY_ENV } from "./registry.js";

declare const __VERSION__: string;
export const VERSION = typeof __VERSION__ === "string" ? __VERSION__ : "0.0.0-dev";

export const HELP = `helloagents: install Claude Code sub-agents and skills from helloagents.run

Usage
  helloagents add <name...>       Install into ./.claude/agents or ./.claude/skills
  helloagents list                List everything in the registry
  helloagents search <query>      Search by name, tag or description
  helloagents remove <name...>    Uninstall from ./.claude

Options
  -g, --global     Use ~/.claude instead of the current project
  -f, --force      Overwrite existing files without asking (add)
  -y, --yes        Don't ask for confirmation (remove)
      --type <t>   Only show "agents" or "skills" (list)
      --json       Print machine-readable JSON (list, search)
  -h, --help       Show this help
  -v, --version    Show the version

Examples
  npx @helloagents/cli add code-reviewer
  npx @helloagents/cli add changelog commit-messages --global
  npx @helloagents/cli search sql

Environment
  ${REGISTRY_ENV}   Registry to use (default ${DEFAULT_REGISTRY_URL}).
                             Accepts an http(s) URL or a local folder.`;

const COMMANDS = ["add", "list", "search", "remove"] as const;
const ALIASES: Record<string, (typeof COMMANDS)[number]> = {
  install: "add",
  i: "add",
  ls: "list",
  find: "search",
  rm: "remove",
  uninstall: "remove",
};

export async function run(argv: string[], io: Io): Promise<number> {
  const style = createStyle(io.color);
  try {
    let parsed;
    try {
      parsed = parseArgs({
        args: argv,
        allowPositionals: true,
        options: {
          global: { type: "boolean", short: "g" },
          force: { type: "boolean", short: "f" },
          yes: { type: "boolean", short: "y" },
          type: { type: "string" },
          json: { type: "boolean" },
          help: { type: "boolean", short: "h" },
          version: { type: "boolean", short: "v" },
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new CliError(`${message}\nRun helloagents --help for usage.`, 2);
    }
    const { values, positionals } = parsed;
    const [rawCommand, ...rest] = positionals;

    if (values.version) {
      io.out(VERSION);
      return 0;
    }
    if (values.help || !rawCommand || rawCommand === "help") {
      io.out(HELP);
      return 0;
    }

    const command = ALIASES[rawCommand] ?? rawCommand;
    const scope = values.global ? "global" : "project";
    switch (command) {
      case "add":
        return await add(io, style, { names: rest, scope, force: Boolean(values.force) });
      case "list": {
        const type = parseType(values.type);
        return await list(io, style, { ...(type && { type }), json: Boolean(values.json) });
      }
      case "search":
        return await search(io, style, { query: rest.join(" "), json: Boolean(values.json) });
      case "remove":
        return await remove(io, style, { names: rest, scope, yes: Boolean(values.yes) });
      default:
        throw new CliError(
          `Unknown command "${rawCommand}". Commands: ${COMMANDS.join(", ")}.\nRun helloagents --help for usage.`,
          2,
        );
    }
  } catch (error) {
    if (error instanceof CliError) {
      io.err(`${style.red("✖")} ${error.message}`);
      return error.exitCode;
    }
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    io.err(
      `${style.red("✖")} Something went wrong: ${detail}\nPlease report this at https://github.com/ShivankK26/helloagents-dot-run/issues`,
    );
    return 1;
  }
}

function parseType(value: string | undefined): "agent" | "skill" | undefined {
  if (value === undefined) return undefined;
  const v = value.toLowerCase();
  if (["agent", "agents", "sub-agent", "sub-agents", "subagents"].includes(v)) return "agent";
  if (["skill", "skills"].includes(v)) return "skill";
  throw new CliError(`--type must be "agents" or "skills", not "${value}".`, 2);
}
