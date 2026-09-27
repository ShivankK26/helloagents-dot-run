---
name: pr-description
description: Writes a clear pull request title and description from the current branch's commits and diff, covering what changed, why, how it was tested, and what reviewers should focus on. Use when opening or updating a pull request, or when asked to write or improve a PR description.
allowed-tools: Bash(git log:*) Bash(git diff:*) Bash(git status:*) Bash(git merge-base:*) Bash(git rev-parse:*) Read
category: git
tags: [pull-requests, git, docs, review]
author: ShivankK26
---

# PR description

Write a description that lets a reviewer understand the change before reading the diff, and lets someone reading `git blame` a year from now understand why it happened.

## Gather context

1. Find the base branch: `git rev-parse --abbrev-ref origin/HEAD` (usually `origin/main`). Use the one the user names if they give one.
2. Read the commits: `git log --no-merges --pretty=format:'%h %s%n%b' <base>..HEAD`.
3. Read the change: `git diff --stat <base>...HEAD`, then the full `git diff <base>...HEAD`. For very large diffs, read the stat first and focus on the files that carry the logic.
4. Look for a PR template in `.github/pull_request_template.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `.github/PULL_REQUEST_TEMPLATE/`, or `docs/`. If one exists, fill it in and keep its headings instead of using the format below.
5. Pick up linked issues from branch names and commit messages (for example `fix/123-...`, `Closes #123`).

## Title

- Under 72 characters, imperative mood: "Add CSV export to reports", not "Added CSV export" or "CSV export".
- Follow the repo's convention if its recent PRs or commits use one (for example Conventional Commits: `feat(reports): add CSV export`).

## Body

Use this structure, and drop any section that would be empty:

```markdown
## Summary

One or two sentences: what this PR does and why it's needed.

## Changes

- The meaningful changes, grouped by area. Describe behavior, not every file.

## How to test

1. Concrete steps or commands a reviewer can run to see it working.

## Notes for reviewers

- Where to focus, trade-offs you made, alternatives you rejected, follow-up work.

Closes #123
```

## Guidelines

- Explain *why*, not only *what*. The diff already shows what.
- Call out anything risky: migrations, breaking API changes, new dependencies, config or environment changes, feature flags. Put them near the top.
- Mention screenshots or recordings for UI changes, and leave a placeholder for the author to add them. Don't invent them.
- Only claim testing that actually happened. If you don't know what was tested, write the steps a reviewer should run and ask the author to confirm.
- Be concise. Most PRs need under 200 words.

## Output

Show the title and body in a markdown code block so they're easy to copy. If the GitHub CLI is available and the user asks you to, you can apply them with `gh pr create --title ... --body-file ...` or `gh pr edit`. Never do that without being asked.
