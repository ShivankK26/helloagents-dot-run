# Changelog

All releases are Mac universal .dmg files on GitHub Releases. Dates are 2026
(IST). Early v0.1/v0.2 entries are grouped from commit history; from v0.2.5 on
each release maps to one change set.

## Before the app (27 Sep – 2 Oct)

- helloagents.run as a **directory of Claude Code sub-agents and skills**: schema
  package, registry (five sub-agents, five skills), CLI (add/list/search/remove),
  Astro site with command-palette search, brand (logo, icons, share image), CI.
  Preserved at tag `directory-v1`.
- 2 Oct: pivot. Scaffolded the Electron app and engine; agent harness with tools,
  budgets and a scripted test model; new landing page.

## v0.1.x (3 Oct)

- **0.1.0**: SQLite trace store with derived logs and errors; Claude Code worker;
  git worktrees; agent detection; desktop app (connect Claude Code, add projects,
  run tasks on their own branch); the Merge logo; universal .dmg; simpler landing page.
- **0.1.1**: Traces, Errors and Evals sections; formatted agent output; lean
  workers (no MCP servers, plugins or skills), with a fallback if the CLI rejects
  the lean flags; collapsible sidebar; new link preview.
- **0.1.2**: New run experience: full-window runs, short summaries, hover sidebar,
  Geist type; runs cut off by closing the app show as stopped, not failed.

## v0.2.0 – v0.2.4 (3–4 Oct)

- **0.2.0**: Composer controls (model, effort, access, branch/checkout, base);
  project actions and checks (detected, editable, send failures back); Ship
  (commit, push, PR, merge); ⌘K palette; Overview; black/white themes.
- **0.2.1–0.2.3**: Sidebar by project as a tree; title bar aligned with the window
  buttons; bigger dropdown chevrons; menus fit the window; cleaner follow-up box and
  run tools; discarded runs say so.
- **0.2.4**: Remove a project (native right-click menu, confirmation listing what
  goes and what stays); Geist everywhere; fixes for scrolling, duplicate steps and
  stage timing. Dark landing page with a live demo of the real app.

## v0.2.5 onward (4–5 Oct)

- **0.2.5**: Attach images (drop, paste, pick) to tasks and follow-ups; `/` menu of
  Claude Code commands and skills (no tokens spent); `/model` and `/effort` open
  the pickers; slash runs use the full setup.
- **0.2.6**: Checks that can't start are fixed automatically (package.json's
  `packageManager`, newer installed Node) or reported plainly; detection prefers
  `packageManager` over lockfiles.
- **0.2.7**: A "Done" line closes each turn; Push / Open PR on it; ship steps
  recorded in the activity; "push it" in the follow-up box ships instead of asking
  the agent; the agent is told helloagents does the git work; relative paths.
- **0.2.8**: Any folder can be a project (git set up locally, secrets kept out).
- **0.2.9**: Approvals like Claude Code (stdio permission prompts): Allow, Always
  allow, Deny; "Needs you" + notification; answers to follow-ups show under the
  question.
- **0.2.10**: Push a project not yet on GitHub (connect or create the repo, push
  the base branch first if empty); screenshots the agent takes show inline; the
  agent is told approvals exist; wider push detection ("also push the code to github").
- **0.2.11**: Plainer push hint (later removed).
- **0.2.12**: Run folders are removed after push/PR/merge (branch kept, folder
  comes back on continue; Changes read from the branch); push hint removed.
- **0.2.13**: After auto-denials, the next follow-up tells the agent (hidden note)
  that approvals work now. Landing page shows the latest version; `pnpm release`.
- **0.2.14**: Enter sends, Shift+Enter new line; copy on select; Changes count only
  includes project files; diff errors shown instead of "No files changed".
- **0.2.15**: Background commands keep running (session stays open; live card;
  agent carries on); sliding sidebar; where-is-code pill; Push opens a PR by
  default; Merge into main also pushes main.
- **0.2.16**: Fixed "Tool permission request failed: Stream closed" (ignore a
  leftover result on resume; never close stdin during a prompt).
- **0.2.17**: Modes: Auto (default), Ask for commands, Plan first, Full access;
  Switch to Auto from an approval card (live mode switch); plan approval card;
  better "Always allow" rule; long commands clamped.
- **0.2.18**: Type while it works (messages reach the running agent); Activity is
  one column; run facts and time split moved under the Changes file list; real
  tool timings.
- **0.2.19**: Activity feed centered and aligned with the chat box, more spacing.
- **0.2.20**: ⌘K palette opens centered and can be dragged anywhere.
- **0.2.21**: Agents can start new runs, commit, push, open PRs and merge
  (`helloagents` command); messages typed mid-task are handled first, then the
  agent carries on; sub-agents (Task) enabled in lean runs.
- **0.2.22**: Agents run git themselves (pull, push, merge, also in the user's
  project folder) instead of handing commands back; older runs are told once.
- **0.2.23**: Task and follow-up boxes grow with the text and can be dragged taller
  or shorter by a grip on the edge (remembered; double-click resets).
