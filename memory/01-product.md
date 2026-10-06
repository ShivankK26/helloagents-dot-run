# The product

## In one line

**Hand off the task. Merge the result.** A desktop app that orchestrates coding
agents (Claude Code now, Codex later) on your own Mac.

## What it does

- **Projects.** Add any folder. Git repos are used as they are; a plain folder
  gets git set up locally (with a `.gitignore` that keeps secrets out).
- **Runs.** Each task is a run. The agent works on its own branch in its own
  folder (a git worktree), so your working copy is never touched. You can also
  choose to work in your current checkout.
- **Checks decide "done".** The project's own commands (tests, lint, typecheck)
  run after the agent finishes. Failing checks are sent back to the agent, at most
  twice. A check that can't even start (wrong Node, wrong package manager) is fixed
  automatically or reported plainly, never blamed on the code.
- **Watch it live.** A readable activity feed: messages, grouped file reads,
  edits with +/−, commands, checks, a "Done" line per turn. Traces, logs and
  errors for every run.
- **Stay in control like Claude Code.** Modes (Auto, Ask for commands, Plan
  first, Full access), approval cards for risky commands, "Always allow" rules
  per project, and typing to the agent while it works.
- **Ship.** Open a PR, merge into main (and push main), or push. helloagents
  connects the project to GitHub (or creates a private repo) if needed. A header
  pill always says where the code is: only on this Mac, on GitHub, PR open, in main.
- **Extras.** Attach screenshots to a task, `/` menu of Claude Code commands
  and skills, background commands that keep running, run folders cleaned up after
  shipping, ⌘K palette, black/white themes.

## Who it's for

Developers who already use Claude Code (or Codex) and want to run several tasks
in parallel, safely, with proof that each one works. The owner is also building
it as a portfolio piece for roles at AI companies: agent harnesses,
orchestration, evals.

## How it makes money (later)

Free and open source, local, bring your own Claude plan or API key. Paid
ideas for later: a Team plan (shared runs, traces, evals; needs a backend and
accounts), credits, cloud runs. Today there is **no backend**: the Electron main
process is the "server", SQLite on disk is the database.

## Positioning

The landing page headline is "Hand off the task. Merge the result." The
sub-copy: hand the task to Claude Code or Codex; it works on its own branch,
your tests decide when it's done, and you ship it in one click. Codex is shown
as "coming soon".

## History

The repo started (late Sep 2026) as **helloagents.run, a directory of Claude Code
sub-agents and skills** (schema package, registry, CLI, Astro site). On 2 Oct 2026
it pivoted to this desktop orchestrator. The old directory is preserved at git tag
`directory-v1`. History was never rewritten: the owner wants their GitHub
contribution graph kept.
