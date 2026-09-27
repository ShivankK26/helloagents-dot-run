/** Bumped only when registry.json changes in a way older CLIs can't read. */
export const REGISTRY_FORMAT_VERSION = 1;

export const ENTRY_TYPES = ["agent", "skill"] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

/** Folder under registry/ (and under .claude/) for each entry type. */
export const TYPE_DIRS = { agent: "agents", skill: "skills" } as const satisfies Record<
  EntryType,
  string
>;

export const CATEGORIES = [
  "code-quality",
  "testing",
  "debugging",
  "security",
  "research",
  "git",
  "docs",
  "data",
  "productivity",
  "devops",
  "design",
  "other",
] as const;
export type Category = (typeof CATEGORIES)[number];

/**
 * Agent Skills naming rule: lowercase letters, digits and single hyphens, no
 * leading or trailing hyphen. We apply it to sub-agents too so every entry has
 * a clean URL and install path.
 */
export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const NAME_MAX = 64;
export const DESCRIPTION_MAX = 1024;
/** Claude Code truncates description + when_to_use beyond this. */
export const SKILL_LISTING_MAX = 1536;
export const TAGS_MAX = 8;
export const GITHUB_HANDLE_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/;

export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_FILES_PER_SKILL = 50;
/** Allowed characters in each segment of a skill's supporting file path. */
export const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;
