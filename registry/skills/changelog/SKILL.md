---
name: changelog
description: Writes or updates a CHANGELOG.md entry from git history in the Keep a Changelog format, grouping changes into Added, Changed, Fixed and similar sections written for users rather than developers. Use when preparing a release, bumping a version, or when asked to update the changelog or write release notes.
allowed-tools: Bash(git log:*) Bash(git tag:*) Bash(git describe:*) Bash(git diff:*) Read
category: git
tags: [changelog, release, git, docs]
author: ShivankK26
---

# Changelog

Turn commits since the last release into a changelog entry that a user of the project can skim in thirty seconds.

## Steps

1. **Find the range.**
   - Last release: `git describe --tags --abbrev=0` (or `git tag --sort=-creatordate | head -5` if tags are inconsistent).
   - If the user named a version or range, use that instead. If there are no tags, use the whole history and say so.
2. **Collect changes.** Run `git log <last-tag>..HEAD --no-merges --pretty=format:'%h %s%n%b'`. For squash-merged PRs the subject often includes the PR number; keep it. If a commit message is too vague to classify, look at `git show --stat <hash>` and the diff.
3. **Read the existing CHANGELOG.md** if there is one, and match its heading style, link style, and wording. If none exists, create one using the template in [references/keep-a-changelog.md](references/keep-a-changelog.md).
4. **Classify each change** into one section:
   - **Added**: new features.
   - **Changed**: changes to existing behavior.
   - **Deprecated**: features that will be removed later.
   - **Removed**: features removed in this release.
   - **Fixed**: bug fixes.
   - **Security**: vulnerability fixes. Always list these, even if small.

   Leave out changes users can't see, such as refactors, CI, test-only changes, formatting, and dependency bumps with no user-visible effect, unless the project's existing changelog includes them.
5. **Rewrite for users.** Describe the effect, not the implementation. "Fixed a crash when exporting an empty report" beats "fix null check in ReportExporter". Start each item with a verb, keep it to one line, and merge related commits into a single item.
6. **Flag breaking changes.** Put anything that requires users to change their code or config at the top of its section, prefixed with **Breaking:**, and include a one-line migration hint.
7. **Pick the version.** If the user didn't give one, suggest the next semantic version: major for breaking changes, minor for additions, patch for fixes only. State your reasoning in one sentence.
8. **Write the entry** at the top of the file, below the `## [Unreleased]` section if the project uses one. Use today's date in `YYYY-MM-DD` format. Update the comparison links at the bottom if the file uses them.

## Output

Edit CHANGELOG.md directly, then show the user the new entry and list any commits you couldn't confidently classify so they can check them. Don't create tags, commit, or push. Leave that to the user.
