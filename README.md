<p align="center">
  <img src="docs/brand/app-icon.svg" width="88" height="88" alt="helloagents logo" />
</p>

# helloagents

A desktop app that orchestrates coding agents. Give it a task: it splits the work across several agents, each in its own git worktree, sends failing tests back to the agent that wrote the code, and hands you one reviewed change to merge. It ships with traces, logs and an eval suite, so you can see how the agents work and measure whether the orchestration helps.

Status: rebuilding from scratch. The previous project in this repo, the helloagents.run sub-agent directory, is preserved at the [`directory-v1`](../../tree/directory-v1) tag.

## Development

Requires Node.js 22.12+ and pnpm (`corepack enable` picks up the pinned version).

```sh
pnpm install      # also downloads the Electron binary
pnpm dev          # open the app with hot reload
pnpm test         # unit tests (no model calls, no cost)
pnpm typecheck
pnpm lint
```

| Path              | What it is                                                                             |
| ----------------- | -------------------------------------------------------------------------------------- |
| `apps/desktop`    | The Electron app: `main/` (Node side), `preload/` (the bridge), `renderer/` (React UI) |
| `packages/engine` | The orchestrator engine. Runs in the app's main process                                |
