# @helloagents/cli

Install Claude Code sub-agents and skills from [helloagents.run](https://helloagents.run) with one command.

```sh
npx @helloagents/cli add code-reviewer
```

Sub-agents are written to `.claude/agents/<name>.md` and skills to `.claude/skills/<name>/` in the current project. Start a new Claude Code session to use them.

## Commands

| Command                                    | What it does                                                  |
| ------------------------------------------ | ------------------------------------------------------------- |
| `helloagents add <name...>`                | Install one or more entries into `./.claude`                  |
| `helloagents add <name> --global`          | Install into `~/.claude` so every project gets it             |
| `helloagents list [--type agents\|skills]` | List everything in the registry (`✓` marks installed entries) |
| `helloagents search <query>`               | Search names, tags and descriptions                           |
| `helloagents remove <name...> [--global]`  | Uninstall (asks first; `--yes` to skip)                       |

`add` never overwrites a file you've changed without asking. Pass `--force` to overwrite anyway. `list` and `search` accept `--json`.

## Configuration

| Variable                   | Default                     | Purpose                                                                                                            |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `HELLOAGENTS_REGISTRY_URL` | `https://helloagents.run/r` | Registry to install from. Accepts an `http(s)` URL or a local folder, such as the output of `pnpm registry:build`. |
| `NO_COLOR` / `FORCE_COLOR` | unset                       | Turn colored output off or on.                                                                                     |

## Safety

Every downloaded file is checked against the SHA-256 in `registry.json`, and the CLI refuses any file path outside the entry's own `agents/` or `skills/<name>/` location.

Requires Node.js 18.18 or newer. No runtime dependencies. MIT licensed.
