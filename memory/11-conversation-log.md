# Conversation log

What the owner asked, roughly in order, and what came of it. Private project
names are left out on purpose.

## 2–3 Oct: from directory to app

- Pivot to a desktop app that orchestrates coding agents; keep history.
- Chose Electron + TS, the minimal dashboard direction, Opus 5 for the harness,
  free local app first.
- Built the engine (harness, traces, Claude Code worker, worktrees), the desktop
  app, the .dmg, the landing page. "Don't teach me anything right now": keep the
  build guide artifact updated instead.
- Asked for a full-window run experience, Geist, collapsible/hover sidebar, then
  v0.2: composer controls, checks, ship, ⌘K, overview, black/white themes.

## 4 Oct: polish, website, removing projects

- Designs first, then build: picked the "Tree" sidebar; fixed title bar alignment,
  bigger dropdown arrows, menus getting cut off, Zed opener error, nicer run tools.
- Landing page: dark theme, Apple logo on download, works with Claude Code or
  Codex, latest product screenshot, then a clickable live demo with sample data.
  Fixed the page jumping on load. Removed internal names and several lines of copy.
- "What if I want to remove a project?": designed (right-click menu + confirm that
  lists what's lost and what stays), then built.
- Asked how to use Claude skills and slash commands; then asked to implement image
  attachments and a searchable `/` menu.

## 5 Oct: making it do everything

- A check failed with `node:sqlite`: pnpm needed Node 22, and the project uses
  yarn. "Shouldn't it fix itself?" → automatic environment fixes.
- Asked whether a backend must be deployed: no.
- The run ended on "Checks yarn lint": wanted a clear "Done". The agent couldn't
  push: helloagents now pushes and opens PRs itself.
- A non-git folder couldn't be added: "allow to open it directly".
- Approvals should work like Claude Code; an answer to a follow-up was hidden →
  approvals + answers under their question.
- "It should do everything": the agent still believed commands were blocked;
  pushing needed a GitHub repo → connect/create repo, screenshots inline,
  agent told about approvals.
- Asked if worktrees get deleted after pushing: "keep it simple, remove after push
  or PR".
- The agent kept refusing in an old session → one-time hidden note. Wanted the
  landing page to always show the newest version → release script.
- Enter to send; "no changes but shows 9" (git was blocked by the Xcode license;
  count included Claude's own notes); copy on select.
- Sidebar should open/close smoothly; "where is my code?" confusion; a background
  download died → sliding sidebar, where-is-code pill, PR by default, background
  commands kept alive.
- "Stream closed" on approvals in a resumed run → fixed.
- Modes like Claude Code, Auto every time → modes, Auto default, Switch to Auto.
- The chat box was locked while working; the side panel wasn't useful in Activity
  → type mid-task, facts moved to Changes, real tool timings.
- Center the activity and space it well → done (v0.2.19).

## 6 Oct

- Asked for this `memory/` folder before closing the session.

## 7 Oct

- The ⌘K search should be movable and centered by default → draggable palette
  with a grip, centered on open, position kept for the session (v0.2.20).
- A run should be able to start new sessions for a project, do a command typed
  mid-task and then carry on, and commit locally. "Keep pushing to main" had been
  silently ignored → `helloagents` command, mid-task note, git commit allowed,
  sub-agents on (v0.2.21).
- It still refused to `git pull`/`push` main and told the user to run them ("it should
  be able to run all the commands itself, i told you this earlier too") → no git
  rules in the prompt, user's folder via --add-dir, note for old runs. A blanket
  git/gh allowlist was blocked as unsafe; the owner picked approvals instead (v0.2.22).
- Long tasks were cut off in the composer ("the chat window should be draggable and
  extendable") → the task and follow-up boxes grow with the text and have a drag
  grip to resize, remembered per box (v0.2.23).
- A half-written task was lost on switching projects ("this should be saved as a draft
  in that project") → per-project drafts, per-run for follow-ups (v0.2.24).
