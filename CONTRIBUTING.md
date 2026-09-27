# Contributing to helloagents.run

Thanks for helping. The most valuable contribution is a new sub-agent or skill that you've actually used and found useful. Adding one takes about five minutes.

## Add an entry in five minutes

### 1. Pick the kind

- **Sub-agent**: a specialist Claude hands a whole job to, such as a review, an audit, research, or writing tests. It runs in its own context window with its own tools.
- **Skill**: instructions (plus optional scripts or reference files) that Claude follows in the main conversation when a task matches, such as a format, a workflow, or house rules.

### 2. Create one file

Fork the repo and add **one** of these:

```
registry/agents/<name>.md          # a sub-agent
registry/skills/<name>/SKILL.md    # a skill (extra files can sit next to SKILL.md)
```

`<name>` is lowercase letters, digits and single hyphens (for example `api-designer`). It must match the `name` in the frontmatter and must not be used by another agent or skill.

**Sub-agent template**

```markdown
---
name: api-designer
description: Designs and reviews REST and GraphQL APIs for consistent naming, versioning and error handling. Use when adding or changing endpoints.
tools: Read, Grep, Glob
category: code-quality
tags: [api, rest, graphql]
author: your-github-username
---

You are an API designer. When invoked:

1. ...
```

**Skill template**

```markdown
---
name: release-notes
description: Drafts customer-facing release notes from merged pull requests. Use when preparing a release announcement.
category: docs
tags: [release, docs]
author: your-github-username
---

# Release notes

1. ...
```

### 3. Check it (optional, CI does this too)

```sh
pnpm install
pnpm registry:validate
```

### 4. Open a pull request

Fill in the checklist in the PR template. CI validates the file, and a maintainer reviews the prompt itself. Once it's merged, the entry is live on the site and installable with `npx @helloagents/cli add <name>`.

## Frontmatter reference

| Field         | Required    | Notes                                                                                                                                      |
| ------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `name`        | yes         | Matches the file or folder name. At most 64 characters: `a-z`, `0-9` and single `-`.                                                       |
| `description` | yes         | What it does **and when to use it**. Claude uses this to decide when to invoke it. At most 1024 characters.                                |
| `category`    | recommended | One of `code-quality`, `testing`, `debugging`, `security`, `research`, `git`, `docs`, `data`, `productivity`, `devops`, `design`, `other`. |
| `tags`        | no          | Up to 8 lowercase tags.                                                                                                                    |
| `author`      | no          | Your GitHub username.                                                                                                                      |

You can also use any field Claude Code supports:

- **Sub-agents** ([docs](https://code.claude.com/docs/en/sub-agents)): `tools`, `disallowedTools`, `model` (`sonnet`, `opus`, `haiku`, `fable`, `inherit` or a full model ID), `permissionMode`, `maxTurns`, `skills`, `mcpServers`, `hooks`, `memory`, `background`, `effort`, `isolation`, `color` and others.
- **Skills** ([docs](https://code.claude.com/docs/en/skills), [spec](https://agentskills.io/specification)): `when_to_use`, `allowed-tools`, `disable-model-invocation`, `user-invocable`, `argument-hint`, `context`, `agent`, `paths`, `license`, `compatibility`, `metadata` and others.

Claude Code silently ignores fields it doesn't recognize, which hides typos. Our validator rejects unknown fields and suggests the one you probably meant. `category`, `tags` and `author` are kept in installed files; Claude Code ignores them.

## What makes a good entry

- **One job, done well.** "Reviews SQL migrations for locking and data loss" beats "database helper".
- **A specific prompt.** Give steps, say what good output looks like, and say what to avoid. Look at `registry/agents/code-reviewer.md` for the level of detail we aim for.
- **Least privilege.** Grant the fewest tools needed. A reviewer doesn't need `Write` or `Edit`.
- **Tested for real.** Use it in Claude Code on a real task before submitting.
- **Safe.** No secrets, tracking, or instructions to send data anywhere. Anything destructive should ask the user first.
- **Not a duplicate.** If something similar exists, improve it instead.

Limits: files up to 256 KB, up to 50 files per skill, no hidden files or symlinks.

## Working on the code

Requirements: Node.js 22.12+ and pnpm (the version is pinned in `package.json`; run `corepack enable` to use it).

```sh
pnpm install
pnpm dev                 # website at http://localhost:4321
pnpm test                # all tests
pnpm lint                # ESLint + Prettier check
pnpm typecheck
pnpm build               # schema, website and CLI
```

| Path                         | What it is                                                                          |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `registry/`                  | The entries                                                                         |
| `packages/schema`            | Zod schemas, the validator, and the registry build (`registry.json` plus raw files) |
| `packages/cli`               | The `@helloagents/cli` package                                                      |
| `apps/web`                   | The Astro site. It serves the registry at `/r/`                                     |
| `docs/design-reference.html` | Generated design reference (`pnpm design:reference`)                                |

To try the CLI against your local registry:

```sh
pnpm registry:build
pnpm --filter @helloagents/cli build
HELLOAGENTS_REGISTRY_URL="$PWD/.registry-out" node packages/cli/dist/index.js list
```

Please keep dependencies to a minimum. The CLI has no runtime dependencies and should stay that way.
