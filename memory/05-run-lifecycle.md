# A run, end to end

1. **Project.** Added from any folder. A plain folder (or a repo with no commits)
   gets `setUpRepo`: `git init -b main`, a default `.gitignore` if missing (secrets
   like `.env`, `*secret*`, keys, certs; `node_modules`, build output, Xcode user
   data), and a first commit. A folder holding several repos offers each one.
2. **Actions.** Setup, checks and dev server are detected from the project's files
   (`detectActions`): `package.json` scripts (the `packageManager` field wins over
   lockfiles), `go.mod`, `Cargo.toml`, `pyproject`/`uv.lock`, `Makefile`. Users
   can edit them. Saved per project.
3. **Start.** `RunManager.start(projectId, task, settings)`. Settings: model,
   effort, mode (`access`), workspace (`branch` = new worktree, or `checkout`),
   base branch, attachments. A worktree is created at
   `worktrees/<project>-<id>-<slug>` on branch `helloagents/<id>-<slug>`; `.helloagents/`
   is excluded from git locally.
4. **Setup** runs in the new folder (e.g. `yarn install`).
5. **Agent turn.** Claude Code runs (see 04). Events stream into SQLite and the UI.
   - Approval needed → the run shows "Needs your OK" with a card: Allow, Always
     allow `<program>` commands, Switch to Auto, Deny. Notification if in background.
   - Plan mode → "Claude's plan" card: Approve and build (switches to Auto) or
     Keep planning.
   - Background command → "Running in the background" card with a timer.
   - The user can type mid-task; it reaches the running agent.
6. **Checks** run after the agent finishes. If they fail, the failure is sent
   back to the agent (at most twice). If a check **couldn't start** (e.g. pnpm
   needs a newer Node, wrong package manager, tool missing), helloagents tries the
   `packageManager` from package.json and newer installed Nodes (nvm, fnm, Volta,
   Homebrew), installing first if needed, and saves what works (`nodeBin`,
   swapped commands). If nothing works: "Checks couldn't run: <why>", not sent to
   the agent.
7. **Done line.** Each turn ends with "✓ Done · N files changed · checks pass · time".
   The last one offers **Merge into main** and **Open PR** (or Push to an open PR).
8. **Follow-ups** continue the same Claude Code session (`--resume`) on the same branch.
9. **Ship** (recorded in the run as `ship` steps):
   - Commit: commits everything in the run folder.
   - Push: commits and pushes the branch. Typing "push it" (or the Push button)
     opens a **PR** by default when no PR exists yet.
   - Open PR: pushes and runs `gh pr create` into the base branch, body from the summary and checks.
   - Merge into main: merges in the user's own checkout (must be clean) and pushes
     the base branch if the project has a GitHub remote.
   - No remote yet → a card asks which GitHub repo (prefilled from a
     `github.com/owner/name` mentioned in the conversation, else
     `<gh login>/<folder>`); `connectGitHub` uses or creates it (private), and
     pushes the base branch first if the repo is empty.
10. **Cleanup.** After a successful push, PR or merge, the run folder is removed
    (unsaved work committed first) and a "Freed N MB" step is recorded. The branch
    stays. A follow-up, Run checks, the dev server or Ship recreate the folder from
    the branch (`restoreWorktree`) and rerun setup where needed. The Changes tab
    reads `git diff base...branch` from the project when the folder is gone.
11. **Discard** deletes the folder and the branch. **Remove project** commits
    unsaved work to each run's branch, removes folders, keeps branches, and forgets
    the project.

## Where is the code? (header pill)

From the run's `ship` steps: **Only on this Mac** → **On GitHub** (pushed) →
**PR open** (click opens it) → **In main** (merged).

## Run states shown in the UI

Working, Needs your OK, Done, Checks failing, Checks couldn't run, Didn't
finish, Stopped. The sidebar groups runs into Needs you / Working / Done.
