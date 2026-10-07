# Architecture

## Monorepo (pnpm workspaces)

```
apps/desktop      Electron app: main process, preload, React renderer, demo build
apps/web          helloagents.run: static site in public/ (Vercel), demo in public/demo
packages/engine   Everything that isn't UI: runs, git, Claude Code worker, traces
packages/cli      Small CLI around the engine (helloagents agent ...)
scripts/release.mjs   One-command release (see 08-dev-workflow.md)
examples/buggy-stats  A tiny repo with a bug, for trying runs
docs/brand        Logo and brand assets
memory/           These notes
```

TypeScript everywhere, Node 22+ (the engine uses `node:sqlite`). Lint with
eslint + prettier (`pnpm lint`), tests with vitest (engine has ~112 tests).

## Engine (`packages/engine/src`)

| Path                     | Role                                                                                                                                                                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runs/manager.ts`        | `RunManager`: start, followUp (also mid-task messages), resume, runChecks, approvals, modes, ship (commit/push/pr/merge), connect GitHub, dev server, free/restore run folders, remove project |
| `runs/actions.ts`        | Detects setup/checks/dev from project files; `runShell`; "couldn't start" detection; installed Node versions; `openPullRequest` via `gh`                                                       |
| `runs/agent-api.ts`      | The `helloagents` command for agents: writes the sh script, local HTTP endpoint, per-run tokens                                                                                                |
| `workers/claude-code.ts` | Runs the `claude` CLI headless, translates its stream into engine events, answers permission prompts, background tasks, mode switches                                                          |
| `workers/slash.ts`       | Lists Claude Code's slash commands and skills without spending tokens                                                                                                                          |
| `workers/detect.ts`      | Which agents are installed (Claude Code, Codex, built-in)                                                                                                                                      |
| `git/worktree.ts`        | git helpers: worktrees, diff, commit, push, merge, `setUpRepo`, `connectGitHub`, `restoreWorktree`, local excludes                                                                             |
| `harness/*`              | helloagents' own agent loop (Anthropic API, tools, budgets, pricing, a scripted test model)                                                                                                    |
| `trace/store.ts`         | SQLite `TraceStore`: projects, runs, events (with migrations)                                                                                                                                  |
| `trace/views.ts`         | Derived views: `digestRun` (files changed, tests, stage, answer, background), log lines, errors                                                                                                |
| `types.ts`               | `AgentEvent`, `RunSettings`, `ProjectActions`, `Access` modes, `PERMISSION_MODES`                                                                                                              |

### Events

Every agent writes the same event stream, so every screen works whatever agent ran:
`agent.start`, `model.response`, `tool.result`, `agent.end`, plus
`agent.background` (background commands) and `user.message` (typed mid-task).
helloagents' own steps are recorded as `tool.result` with special names:
`setup`, `checks`, `ship` (input `{kind, url}`), `folder` (freed/restored/discarded).

## Desktop app (`apps/desktop/src`)

- `main/index.ts`: Electron main process. Creates the `RunManager`, registers IPC
  handlers, notifications, the native project menu, Dock badge, quit prompt,
  login-shell PATH loading, `HELLOAGENTS_*` dev env vars.
- `preload/index.ts`: exposes exactly the `HelloagentsApi` as `window.helloagents`.
- `shared/api.ts`: the typed API and `IPC` channel names (main and preload share them).
- `renderer/src`: React app. Key components: `App`, `Sidebar`, `NewTask`
  (composer), `RunScreen` (run header, tabs, Dock follow-up box, ship/connect
  cards, run facts), `ActivityFeed`, `ChangesView`, `TraceView`, `SlashMenu`,
  `Attachments`, `Menu`, `Palette`, `Overview`, `ErrorsPage`, `TracesPage`.
  Helpers: `outcome.ts` (status/tone), `ship.ts` (push intent, where-is-code,
  short paths), `composer.ts` (models, efforts, modes, saved settings),
  `copyOnSelect.ts`, `toast.ts`.
- `demo/`: an in-memory `HelloagentsApi` (`mockApi.ts`) with sample projects so the
  real UI runs in a browser for the website.

The renderer is sandboxed; it only talks to main through the typed IPC.

## Data on disk

`~/Library/Application Support/helloagents/` (override with `HELLOAGENTS_DATA_DIR`):

- `helloagents.db`: SQLite (projects, runs, events)
- `worktrees/<project>-<id>-<slug>/`: run folders (removed after push/PR/merge)
- `attachments/`: images attached to tasks

Branches are named `helloagents/<id>-<slug>`. Screenshots the agent takes go in
the run folder's `.helloagents/screenshots/`, excluded from git locally.

## No backend

Users download the .dmg; everything runs locally with their own Claude plan.
A backend would only be needed for team features, billing or cloud runs.
