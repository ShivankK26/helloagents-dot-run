<!-- Thanks for contributing! Delete the sections that don't apply. -->

## What this adds or changes

<!-- One or two sentences. For a new entry: what job does it do, and when would someone use it? -->

## Type of change

- [ ] New sub-agent (`registry/agents/<name>.md`)
- [ ] New skill (`registry/skills/<name>/SKILL.md`)
- [ ] Improvement to an existing entry
- [ ] Website, CLI, or tooling

## Checklist for new or changed entries

- [ ] `name` matches the file or folder name and is lowercase-with-hyphens
- [ ] `description` says what it does **and when to use it**
- [ ] `category` is set, and `author` is my GitHub username
- [ ] The prompt is specific: steps, what good output looks like, and what to avoid
- [ ] Tools are the minimum needed (a read-only reviewer doesn't need `Write` or `Edit`)
- [ ] No secrets, tracking, or instructions to send data to third parties
- [ ] I've used it in Claude Code on a real task and it worked
- [ ] `pnpm registry:validate` passes (CI checks this too)

## Checklist for code changes

- [ ] `pnpm lint`, `pnpm typecheck` and `pnpm test` pass
- [ ] `pnpm build` succeeds
