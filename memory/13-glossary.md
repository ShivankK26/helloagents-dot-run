# Glossary

- **Run**: one task given to an agent, with its follow-ups, on one branch.
- **Turn**: one round of agent work inside a run (the first task, or a follow-up).
- **Worktree / run folder**: a separate checkout of the project for one run
  (`worktrees/<project>-<id>-<slug>`), on branch `helloagents/<id>-<slug>`.
- **Checkout mode**: the run works in your own working copy instead of a worktree.
- **Base branch**: where the run started from and where Merge goes (usually `main`).
- **Actions**: a project's setup, checks and dev server commands (`ProjectActions`).
- **Checks**: commands that decide whether a run is done (tests, lint, typecheck).
- **Send back**: failing checks returned to the agent to fix (at most twice).
- **Couldn't start / cantStart**: a check whose tool crashed before running (old Node,
  wrong package manager); not the code's fault.
- **Ship**: Commit, Push, Open PR, Merge into main, done by helloagents.
- **Where-is-code pill**: Only on this Mac / On GitHub / PR open / In main.
- **Freed folder**: a run folder removed after shipping; the branch is kept and the
  folder is restored on demand.
- **Mode (`access`)**: auto, edits (Ask for commands), plan (Plan first), full (Full access).
- **Approval**: Claude Code asking to use a tool that isn't pre-approved; answered
  with Allow, Always allow, Switch to Auto or Deny.
- **Always allow rule**: e.g. `Bash(xcodebuild:*)`, saved per project.
- **Lean worker**: Claude Code started without the user's MCP servers, plugins
  and skills, to save tokens.
- **Harness**: helloagents' own agent loop on the Anthropic API.
- **Digest**: the summary derived from a run's events (files changed, tests, stage,
  answer, background).
- **Stream-json**: Claude Code's line-by-line JSON protocol on stdin/stdout.
- **Control request/response**: stream-json messages for permissions and mode switches.
- **Demo / mock API**: the real UI running on fake data for the website.
- **Build guide**: the private artifact that explains the project in depth.
