# Developing helloagents

## Setup on the owner's Mac

- The shell's default Node is 20 (nvm), but pnpm 11 and the engine need **Node 22+**.
  Prefix commands with:
  `export PATH="$HOME/.nvm/versions/node/v22.23.1/bin:$PATH"`
- Electron downloads its binary via `install-electron` (desktop postinstall).
- If `git` or `python3` suddenly fail with "You have not agreed to the Xcode
  license agreements", Xcode was updated: run `sudo xcodebuild -license accept`
  (needs the owner's password). This also breaks helloagents itself (it needs git).
  For one-off edit scripts, use Node instead of python3.

## Everyday commands (repo root)

```
pnpm dev                     # desktop app with hot reload
pnpm -r typecheck            # all packages
pnpm lint                    # eslint + prettier --check
pnpm exec prettier --write . # format
pnpm -r test                 # vitest (engine has the tests)
pnpm --filter @helloagents/desktop demo   # rebuild the website demo
pnpm --filter @helloagents/desktop dist   # build the universal Mac .dmg
```

## Releasing (always this way)

```
pnpm release 0.2.20 "short headline" --notes "- bullet one
- bullet two"
```

`scripts/release.mjs`: bumps `apps/desktop/package.json`, updates the landing
badge (version + headline), rebuilds the demo and the .dmg, commits and pushes
(deploying the site), creates the GitHub release with the .dmg, quits the app and
installs the new one into `/Applications`, then opens it. Installing restarts the
app, which stops running tasks; say so to the owner. The app is ad-hoc signed,
not notarized (first launch needs "Open Anyway").

## Testing

- **Engine tests** use a fake CLI: `packages/engine/test/fixtures/fake-claude.mjs`.
  It replays real stream-json shapes and edits a file. Modes via
  `FAKE_CLAUDE_MODE`: success, fail, error, crash, slow, rich, ask (approval
  prompt), denied (auto-denial text), early (leftover result on resume), background,
  chat (message mid-task). `FAKE_CLAUDE_ARGS_FILE` records the args and prompt,
  `FAKE_CLAUDE_ANSWER_FILE` the approval answer, `FAKE_CLAUDE_REJECT_LEAN` plays an old CLI.
- **Probe the real CLI** for anything protocol-related: a small Node script that
  spawns `claude -p --input-format stream-json ...` with `--model haiku` and prints
  each message. Cheap, and it caught every gotcha in 04.
- **Screenshots of the UI** without touching the real app: build the demo, serve
  `apps/web/public` on 127.0.0.1:4321 (a tiny Node static server), write a temporary
  HTML page that iframes `/demo/?embed` and scripts clicks/typing, and capture with
  headless Chrome (`--headless=new --screenshot --virtual-time-budget=6000`). Delete
  the temp page after. Headless Chrome captures black if the page itself scrolls;
  scroll inner elements instead.
- **The real packaged app** can be driven with `HELLOAGENTS_DATA_DIR` (temp data),
  `HELLOAGENTS_CLAUDE_PATH` (fake CLI), `HELLOAGENTS_CAPTURE=<png>`,
  `HELLOAGENTS_CAPTURE_SCRIPT` (JS to run first) and `HELLOAGENTS_CAPTURE_WAIT`.
- Reading the real database for debugging:
  `sqlite3 ~/Library/Application\ Support/helloagents/helloagents.db` (tables
  `projects`, `runs`, `events`; runs have `worktree_path`, `branch`, `base_commit`, `settings`).

## Conventions

- Match the surrounding code: comment density, naming, small focused helpers.
- Commit messages: a short title, a body that explains the why, and the
  `Co-Authored-By` line.
- After shipping a feature, update the build guide artifact and these notes.

## Native module: node-pty (the terminal)

- The only runtime dependency shipped in the app (`dependencies` in apps/desktop);
  everything else is bundled. Uses node-pty's prebuilt binaries (N-API, both chips):
  `allowBuilds: node-pty: false`, `npmRebuild: false`, `asarUnpack` node-pty, and
  `mac.x64ArchFiles` covering its prebuilds so the universal merge accepts them.
- Its `spawn-helper` ships without the executable bit ("posix_spawnp failed"):
  `scripts/pty-helper.mjs` (run by `dist`) sets it, and main also sets it at runtime.
- Testing the packaged app while the real one runs: pass `--user-data-dir=<tmp>` too,
  or the single-instance lock quits it immediately.
