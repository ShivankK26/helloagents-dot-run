# How helloagents drives Claude Code

All of this is in `packages/engine/src/workers/claude-code.ts`. It was worked
out by probing the real CLI (Claude Code 2.1.x) with small scripts; the probes
are the source of truth when something changes.

## The command line

```
claude -p --output-format stream-json --verbose
  --input-format stream-json --replay-user-messages      # task and messages over stdin
  --permission-mode <auto|acceptEdits|plan|bypassPermissions>
  --allowedTools <defaults + the project's "Always allow" rules>
  --permission-prompts host --permission-prompt-tool stdio   # helloagents answers prompts
  --append-system-prompt <helloagents notes>
  [lean flags] [--add-dir <attachments>] [--model] [--effort] [--resume <session>]
```

- **Lean flags** (default, saves tens of thousands of tokens per turn):
  `--strict-mcp-config --setting-sources project,local --disable-slash-commands
--tools Read,Edit,Write,Glob,Grep,Bash,Task`. `Task` is the sub-agent tool (the CLI
  also accepts `Agent` as an alias, probed on 2.1.291); sub-agent messages are ignored. If an older CLI rejects a flag, the run
  retries once without them. A task that starts with `/` (a slash command or
  skill) runs **without** lean flags so the user's skills load.
- **Modes** map to `--permission-mode`: Auto → `auto` (Claude approves safe
  actions itself), Ask for commands → `acceptEdits`, Plan first → `plan`,
  Full access → `bypassPermissions` (no prompts at all).
- **The appended system prompt** says: you're on your own branch; run the commands
  the work needs yourself, git included (commit, pull, push, merge), here or in the
  user's project folder (passed with `--add-dir`); never hand commands back to the
  user; no force-push; `helloagents` shortcuts (below); take screenshots into `.helloagents/screenshots/` and Read them so
  the user sees them; when approvals are on, earlier automatic denials no longer apply.

## Stdin stays open (the key design)

The task is sent as a stream-json user message and stdin is kept open until the
run is really over. That enables:

1. **Approvals.** Claude Code writes `{"type":"control_request","request":{"subtype":"can_use_tool",...}}`
   and waits. The engine calls `onPermission`, the app shows a card, and the
   answer goes back as a `control_response` (`behavior: allow`, optionally
   `updatedPermissions` for "always" with `destination: "session"`, or `deny` with
   a message). Plan approval arrives as tool `ExitPlanMode` with `input.plan`.
2. **Mode switches mid-run.** The host sends
   `{"type":"control_request","request":{"subtype":"set_permission_mode","mode":"auto"}}`.
   Used by the "Switch to Auto" button and "Approve and build" on plans.
3. **Background commands.** Claude Code emits
   `system/background_tasks_changed` (and `task_started`, `task_notification`).
   A `result` that arrives while tasks are running is not the end: when the job
   finishes, Claude Code starts a new turn by itself (a second `system/init`, which
   is ignored) and reports. The run ends at a `result` with nothing in the background.
4. **Messages while it works.** Extra user messages written to stdin are folded
   into the current turn, with a `[Note from helloagents]` (`MID_TASK_NOTE`): do this
   first, say so in a line, then carry on. Without it, "keep pushing to main" was read
   and silently ignored (7 Oct). The feed shows only what the user typed. `--replay-user-messages` echoes them back (`isReplay`)
   once read; the engine records them as `user.message`. If one arrives just as the
   turn ends, the run waits for its turn instead of closing.

- **No blanket git allowlist.** Pre-approving every `git`/`gh` command was blocked
  as unsafe (7 Oct); the owner chose: agents run git themselves, Auto mode's own
  checks decide what needs an OK (fetch/merge/push ask; "Always allow" `Bash(git:*)`
  per project stops that). Only status/diff/log/add/commit are pre-allowed.
- **Old runs** (no `settings.agentRuns`) get a one-time `RULES_NOTE` on their next
  follow-up: the "can't commit or push" rule is gone. Long resumed sessions kept
  refusing without it.

## The `helloagents` command (agent → app)

`runs/agent-api.ts`. The engine writes a small sh+curl script to
`<data dir>/bin/helloagents` and starts an HTTP endpoint on 127.0.0.1 (random
port). Each Claude Code process gets `PATH` with that folder first,
`HELLOAGENTS_API` and a per-run `HELLOAGENTS_TOKEN` (the token says which run asks).
`Bash(helloagents *)` is pre-allowed.

- `helloagents new [--project NAME] "<task>"`: starts a new run (same model, effort,
  mode and base branch), records a `run` step in the asking run (feed row with
  **Open**). At most 8 per run.
- `helloagents commit | push | pr | merge`: the normal Ship actions, allowed while
  that run is still working (`ship(runId, kind, byAgent=true)`); the folder isn't
  freed mid-run. "Keep pushing to main" → the agent runs `helloagents merge`.

Tested for real with Haiku: it committed with git and started a second run.

## Gotchas found (and fixed)

- **Headless prompts nobody answers.** With `--permission-prompts none` (the old
  default), anything needing approval was auto-denied and Claude was told it would
  be denied "for the rest of this session". Resumed runs then refused even after
  approvals existed. Fix: the first follow-up after an auto-denial carries a hidden
  `[Note from helloagents]` saying approvals work now.
- **"host" alone doesn't ask.** `--permission-prompts host` without
  `--permission-prompt-tool stdio` still auto-denies.
- **Leftover result on resume.** A resumed session can emit an empty successful
  `result` before reading the new message. Closing stdin on it caused
  "Tool permission request failed: AbortError: Stream closed". The engine now
  ignores a successful result with zero turns, and never closes stdin while a
  prompt is open.
- **Background jobs died with the turn.** When stdin was closed at the first
  result, the CLI exited and killed e.g. a multi-GB `xcodebuild -downloadPlatform`.
- **Tool timings.** Claude Code doesn't report tool durations; the engine measures
  from the tool request to its result.
- **Sub-agent messages** carry `parent_tool_use_id` and are ignored.
- **Files outside the project** (Claude's own `~/.claude/projects/.../memory`
  notes) are not counted as changes.

## Listing slash commands without tokens

`workers/slash.ts` starts `claude -p ... --max-turns 1`, reads the first
`system/init` line (`slash_commands`, `skills`, `plugins`), and kills the process.
Descriptions come from `SKILL.md` / `commands/*.md` front matter in
`~/.claude`, the project's `.claude`, and plugin folders. Session-only commands
(`/clear`, `/compact`, `/config`, `/model`...) are hidden; `/model` and `/effort`
open helloagents' own pickers. Cached per project per app launch.

## Attachments

Images are saved to the app's `attachments/` folder, `--add-dir` gives Claude
access, and an `[Attached images]` list of paths is appended to the prompt. The
feed hides that note and shows chips.

## "Always allow" rules

`suggestedRule` picks the program doing the work: it skips `cd`, env
assignments and output helpers (`head`, `grep`, `sort`...), so
`cd x && xcodebuild ... | head` becomes `Bash(xcodebuild:*)`. Saved per project
(`ProjectActions.alwaysAllow`) and passed in `--allowedTools` next time.
