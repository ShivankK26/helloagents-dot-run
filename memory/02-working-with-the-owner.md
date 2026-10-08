# Working with the owner

How the owner likes to work, learned over the build. Follow these unless they
say otherwise.

## Communication

- **Keep answers short.** "Tell in short, brother." Lead with the answer, then a
  few bullets. Explain in plain words when something is confusing ("I didn't
  understand what the issue is about" means: say it like you'd say it to a friend).
- No inline teaching during work ("don't teach me anything rn"). Instead keep the
  **build guide artifact** up to date at the end of work:
  https://claude.ai/artifact/Eb9F4vVBDsMF8zZB5dRTky (republish to the same URL).
  It covers the tech at a high level and then in depth, in layman's terms too.

## Product taste

- **The app should do everything itself.** Don't hand steps back to the user
  ("it should do everything, fix it"). Examples that became features: helloagents
  pushes and opens PRs; it connects or creates the GitHub repo; it fixes a broken
  check setup; it adds non-git folders directly; it asks for approvals instead of
  failing; background commands keep running. **Agents must never hand commands
  back** ("run these in Terminal"): they run git and everything else themselves,
  asking for approval when needed (said twice, 7 Oct).
- **Agents get the full Claude Code**: skills, plugins, MCP connectors, every tool. No
  stripped-down workers (lean mode was dropped on 8 Oct for this).
- **Auto mode by default, every time.** They want to automate their tasks.
- **Keep it simple.** When offered a nuanced design, they often pick the simpler
  one ("no keep it simple: once pushed or a PR is raised, remove the worktree").
- **Short, plain UI copy.** They asked to remove lines that explain too much
  ("remove this line", "Free and open source", "Apple silicon and Intel"...).
- **Show designs first** for bigger UI changes: mock it as an artifact, let them
  pick (they've chosen options like "A · Tree"), then build. Small fixes: just do them.
- **Look:** pure black and white themes (title-bar switch), Geist Sans + Geist Mono
  everywhere, orange (`--accent`) only for main actions and live work. No gradients
  ("the colourful gradients looked bad"), no heavy glows (the "lamp" is a soft hairline).
- They review with screenshots and circle problems. Alignment, spacing and
  overflow matter to them (centered, well spaced, nothing cut off).

## Standing rules

- **Commit and push after each completed step** ("keep pushing code").
- **Release with one command** and keep the landing page on the newest version:
  `pnpm release <x.y.z> "<headline>" --notes "..."` (see 08-dev-workflow.md).
  After releasing, the new app is installed into /Applications for them.
- **Never rewrite git history or delete the repo** (contribution graph).
- **Never show their private projects in public material** (website, demo,
  screenshots, these notes). The demo uses made-up projects (orbit-app, HydraDB,
  acme-web).
- Pushing their own projects' code to GitHub is their call; don't push it for them.
- Default model for the built-in harness: Claude Opus 5 (`claude-opus-5`).
  Ask for an API key only at the first real harness run.
