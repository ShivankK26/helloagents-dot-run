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
--tools Read,Edit,Write,Glob,Grep,Bash`. If an older CLI rejects a flag, the run
  retries once without them. A task that starts with `/` (a slash command or
  skill) runs **without** lean flags so the user's skills load.
- **Modes** map to `--permission-mode`: Auto → `auto` (Claude approves safe
  actions itself), Ask for commands → `acceptEdits`, Plan first → `plan`,
  Full access → `bypassPermissions` (no prompts at all).
- **The appended system prompt** says: you're on your own branch; don't
  `git commit/push/remote` or `gh pr` (helloagents ships); leave changes
  uncommitted; take screenshots into `.helloagents/screenshots/` and Read them so
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
   into the current turn. `--replay-user-messages` echoes them back (`isReplay`)
   once read; the engine records them as `user.message`. If one arrives just as the
   turn ends, the run waits for its turn instead of closing.

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
