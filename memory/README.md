# helloagents memory

Notes for picking this project up in a new session (human or AI). They cover
what helloagents is, how it's built, every decision made so far and why, how
to build, test and release, and what's still open.

Last updated: 8 Oct 2026, at **v0.2.24**.

## Read in this order

| File                                                           | What's in it                                                                  |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [01-product.md](01-product.md)                                 | What helloagents is, who it's for, the business model                         |
| [02-working-with-the-owner.md](02-working-with-the-owner.md)   | How the owner likes to work: tone, design process, standing rules             |
| [03-architecture.md](03-architecture.md)                       | Monorepo layout, engine, desktop app, IPC, data on disk                       |
| [04-claude-code-integration.md](04-claude-code-integration.md) | Exactly how helloagents drives the `claude` CLI, and the gotchas found        |
| [05-run-lifecycle.md](05-run-lifecycle.md)                     | A run end to end: worktree, setup, agent, approvals, checks, ship, cleanup    |
| [06-ui.md](06-ui.md)                                           | Screens, components and the design rules behind them                          |
| [07-website-and-demo.md](07-website-and-demo.md)               | helloagents.run, the live demo, the version badge, deploys                    |
| [08-dev-workflow.md](08-dev-workflow.md)                       | Commands, testing (fake Claude Code, screenshots), releasing, machine gotchas |
| [09-changelog.md](09-changelog.md)                             | Every release, v0.1.0 to v0.2.24                                              |
| [10-decisions.md](10-decisions.md)                             | The choices made, with the reason for each                                    |
| [11-conversation-log.md](11-conversation-log.md)               | What was asked, in order, and what came of it                                 |
| [12-open-items.md](12-open-items.md)                           | Roadmap, known gaps, things not yet tested for real                           |
| [13-glossary.md](13-glossary.md)                               | Terms used in the code and these notes                                        |

## The state in one paragraph

helloagents is a Mac app (Electron + TypeScript) that runs coding agents for you.
You pick a project, describe a task, and Claude Code works on its own git branch
in a separate folder (a worktree). The project's own checks decide when it's
done. You watch the work live, approve risky commands (Auto mode by default),
type to it while it works, and ship with one click: open a PR, merge into main,
or push. Everything is local; there is no backend. Codex support, evals and
notarization are the main things not built yet.

## Elsewhere

- Code: https://github.com/ShivankK26/helloagents-dot-run (public; the name is kept on purpose)
- Website: https://www.helloagents.run (Vercel, deploys from `main`)
- Releases (Mac .dmg): https://github.com/ShivankK26/helloagents-dot-run/releases
- Build guide (private artifact, kept current): https://claude.ai/artifact/Eb9F4vVBDsMF8zZB5dRTky
