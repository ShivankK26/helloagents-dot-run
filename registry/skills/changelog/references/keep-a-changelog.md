# Keep a Changelog template

Based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and [Semantic Versioning](https://semver.org/).

Use this when a project has no CHANGELOG.md yet. Replace `OWNER/REPO` with the real repository.

```markdown
# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.2.0] - 2026-03-14

### Added

- Export reports as CSV from the reports page (#142).

### Changed

- **Breaking:** `createClient()` now requires an `apiKey` option. Pass the key you previously set with `setApiKey()`.

### Fixed

- Fixed a crash when exporting an empty report (#150).

### Security

- Session cookies are now marked `Secure` and `HttpOnly`.

[Unreleased]: https://github.com/OWNER/REPO/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/OWNER/REPO/compare/v1.1.0...v1.2.0
```

## Rules

- Newest version first.
- One `## [version] - YYYY-MM-DD` heading per release.
- Only include sections that have entries, in this order: Added, Changed, Deprecated, Removed, Fixed, Security.
- Keep an `## [Unreleased]` section at the top so upcoming changes have somewhere to go.
- Yanked releases are marked `## [1.1.1] - 2026-02-01 [YANKED]`.
