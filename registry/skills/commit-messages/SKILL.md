---
name: commit-messages
description: Writes clear git commit messages for staged changes following the Conventional Commits format, or the repository's own convention if it has one, with a concise subject and a body explaining why. Use when committing changes, when asked to write or fix a commit message, or when splitting work into logical commits.
allowed-tools: Bash(git diff:*) Bash(git status:*) Bash(git log:*) Read
category: git
tags: [git, commits, conventional-commits]
author: ShivankK26
---

# Commit messages

Write the message a careful teammate would write: specific, honest about what changed, and useful to someone running `git log` later.

## Steps

1. Run `git diff --staged`. If nothing is staged, look at `git status` and `git diff`, and ask the user what they intend to commit rather than guessing.
2. Check the repo's convention with `git log --oneline -20`. If recent commits follow a clear style (Conventional Commits, ticket prefixes like `PROJ-123:`, Gitmoji, or plain sentences), match it. Otherwise use Conventional Commits.
3. If the staged changes do several unrelated things, suggest splitting them into separate commits and say which files or hunks belong together.
4. Write the message.

## Format

```
<type>(<optional scope>): <subject>

<body: what changed and why, wrapped at 72 characters>

<footer: BREAKING CHANGE: ..., Closes #123, Co-authored-by: ...>
```

**Types:** `feat` (new feature), `fix` (bug fix), `docs`, `style` (formatting only), `refactor` (no behavior change), `perf`, `test`, `build`, `ci`, `chore`, `revert`.

**Subject line**

- Imperative mood, as if completing "If applied, this commit will…": `add`, `fix`, `remove`, not `added` or `adds`.
- 50 characters is the target and 72 is the hard limit. No trailing period.
- Lowercase after the colon, unless the repo capitalizes.
- Be specific: `fix(auth): refresh expired tokens before retrying` beats `fix: bug`.
- The scope is the area of the codebase (`api`, `parser`, `ui`). Leave it out if nothing obvious fits.

**Body** (skip for trivial changes)

- Explain the motivation and the effect: what was wrong or missing, and why this approach.
- Mention anything non-obvious: side effects, trade-offs, follow-up work.
- Don't narrate the diff line by line.

**Breaking changes:** add `!` after the type or scope (`feat(api)!: ...`) and a `BREAKING CHANGE:` footer describing what users must do.

## Examples

```
fix(cart): prevent negative quantities when removing items

Removing an item twice in quick succession could drive the quantity
below zero because both requests read the same stale value. Clamp at
zero and make the decrement atomic in the database.

Closes #482
```

```
docs: explain how to run the test suite against a local database
```

## Output

Show the message in a code block. Only run `git commit` if the user asked you to commit. When you do, pass the message with a heredoc or `-F` so line breaks survive, and never add `--no-verify`.
