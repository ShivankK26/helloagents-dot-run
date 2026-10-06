# Open items

## Roadmap (not built yet)

| Item         | Notes                                                                                                                 |
| ------------ | --------------------------------------------------------------------------------------------------------------------- |
| Codex        | Codex CLI as a second agent on the user's ChatGPT plan. Shown as "coming soon" in the agent picker and on the website |
| Attempts     | Several agents try one task in parallel; checks pick the winner ("1 attempt" chip is disabled)                        |
| Evals        | Run a fixed task set against setups; compare pass rate, time, cost (Evals page is a placeholder)                      |
| Panels       | Terminal and live preview panels beside a run                                                                         |
| First run    | Import projects from Claude Code and Codex history                                                                    |
| Notarization | Removes "Open Anyway" on first launch; needs a paid Apple developer account                                           |
| Auto-update  | Could read GitHub Releases; nothing built yet                                                                         |
| Team plan    | Would need a small backend (accounts, sync of traces/evals); later                                                    |

## Known gaps and things to watch

- **Tested mostly against the fake CLI.** Approvals, Auto mode, mode switching,
  background commands and mid-task messages were each probed against the real
  Claude Code; the full flows inside the app have mainly been exercised through
  the owner's own runs. Keep probing the real CLI when changing the protocol.
- **Installing an update restarts the app**, which stops running tasks (they show
  as stopped; a follow-up continues them).
- The run title is the first line of the task, which can be long.
- Old runs (before v0.2.18) show 0ms for reading files and running commands.
- The Ship menu still offers plain Commit and Push branch for power use; the
  Done line and "push it" default to a PR.
- Messages typed while checks are running (agent already finished) are sent as a
  follow-up after the run, not mid-task.
- `ENGINE_VERSION` in `packages/engine/src/index.ts` is still "0.1.0" (the app
  version is what's released).

## The owner's own projects

The owner has been using helloagents on their own repos (a portfolio site, an
iOS app). Last state of the iOS run: build succeeded on the simulator; it may
still need the iOS simulator runtime and an approval or two. Don't record those
projects' details here: this repo is public.
