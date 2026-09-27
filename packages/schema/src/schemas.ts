import { z } from "zod";
import {
  CATEGORIES,
  DESCRIPTION_MAX,
  GITHUB_HANDLE_PATTERN,
  NAME_MAX,
  NAME_PATTERN,
  SKILL_LISTING_MAX,
  TAGS_MAX,
} from "./constants.js";

const stringOrList = z.union([z.string().trim().min(1), z.array(z.string().trim().min(1)).min(1)]);

/** Claude Code accepts true/false plus yes/no/on/off/1/0 for skill booleans. */
const looseBoolean = z.union([
  z.boolean(),
  z.literal(0),
  z.literal(1),
  z.string().regex(/^(true|false|yes|no|on|off|1|0)$/i, "must be true or false"),
]);

const effort = z.enum(["low", "medium", "high", "xhigh", "max"]);

const model = z.union([
  z.enum(["sonnet", "opus", "haiku", "fable", "inherit"]),
  z
    .string()
    .regex(
      /^claude-[a-z0-9.-]+$/,
      "must be sonnet, opus, haiku, fable, inherit, or a full model ID",
    ),
]);

const name = z
  .string()
  .min(1, "is required")
  .max(NAME_MAX, `must be at most ${NAME_MAX} characters`)
  .regex(NAME_PATTERN, "must be lowercase letters, digits and single hyphens (e.g. code-reviewer)");

const description = z
  .string()
  .trim()
  .min(1, "is required")
  .max(DESCRIPTION_MAX, `must be at most ${DESCRIPTION_MAX} characters`);

/** Directory-only fields. Claude Code ignores unknown fields, so these stay in installed files. */
const directoryFields = {
  category: z.enum(CATEGORIES).optional(),
  tags: z
    .array(
      z
        .string()
        .regex(NAME_PATTERN, "tags must be lowercase letters, digits and hyphens")
        .max(32, "tags must be at most 32 characters"),
    )
    .max(TAGS_MAX, `at most ${TAGS_MAX} tags`)
    .refine((tags) => new Set(tags).size === tags.length, "tags must not repeat")
    .optional(),
  author: z
    .string()
    .transform((s) => s.replace(/^@/, ""))
    .pipe(z.string().regex(GITHUB_HANDLE_PATTERN, "must be a GitHub username (e.g. octocat)"))
    .optional(),
};

/** https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields */
export const agentFrontmatterSchema = z.object({
  name,
  description,
  tools: stringOrList.optional(),
  disallowedTools: stringOrList.optional(),
  model: model.optional(),
  permissionMode: z
    .enum(["default", "acceptEdits", "auto", "dontAsk", "bypassPermissions", "plan", "manual"])
    .optional(),
  maxTurns: z.number().int().positive().optional(),
  skills: z.array(z.string().min(1)).optional(),
  mcpServers: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
  hooks: z.record(z.string(), z.unknown()).optional(),
  memory: z.enum(["user", "project", "local"]).optional(),
  background: z.boolean().optional(),
  omitClaudeMd: z.boolean().optional(),
  effort: effort.optional(),
  isolation: z.literal("worktree").optional(),
  color: z.enum(["red", "blue", "green", "yellow", "purple", "orange", "pink", "cyan"]).optional(),
  initialPrompt: z.string().min(1).optional(),
  experimental: z.record(z.string(), z.unknown()).optional(),
  ...directoryFields,
});

/**
 * https://agentskills.io/specification plus the Claude Code extensions in
 * https://code.claude.com/docs/en/skills#frontmatter-reference
 */
export const skillFrontmatterSchema = z
  .object({
    name: name.refine(
      (n) => n !== "synced" && !n.startsWith("anthropic-skills"),
      "is reserved by Claude Code",
    ),
    description,
    when_to_use: z.string().trim().min(1).optional(),
    "argument-hint": z.string().min(1).optional(),
    arguments: stringOrList.optional(),
    "disable-model-invocation": looseBoolean.optional(),
    "user-invocable": looseBoolean.optional(),
    "allowed-tools": stringOrList.optional(),
    "disallowed-tools": stringOrList.optional(),
    model: model.optional(),
    effort: effort.optional(),
    context: z.literal("fork").optional(),
    agent: z.string().min(1).optional(),
    background: looseBoolean.optional(),
    hooks: z.record(z.string(), z.unknown()).optional(),
    paths: stringOrList.optional(),
    shell: z
      .string()
      .regex(/^(bash|powershell)$/i, "must be bash or powershell")
      .optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    license: z.string().min(1).optional(),
    compatibility: z.string().min(1).max(500, "must be at most 500 characters").optional(),
    ...directoryFields,
  })
  .refine((fm) => fm.description.length + (fm.when_to_use?.length ?? 0) <= SKILL_LISTING_MAX, {
    message: `description and when_to_use together must be at most ${SKILL_LISTING_MAX} characters`,
    path: ["description"],
  });

export type AgentFrontmatter = z.infer<typeof agentFrontmatterSchema>;
export type SkillFrontmatter = z.infer<typeof skillFrontmatterSchema>;

export const KNOWN_AGENT_FIELDS: readonly string[] = Object.keys(agentFrontmatterSchema.shape);
export const KNOWN_SKILL_FIELDS: readonly string[] = [
  "name",
  "description",
  "when_to_use",
  "argument-hint",
  "arguments",
  "disable-model-invocation",
  "user-invocable",
  "allowed-tools",
  "disallowed-tools",
  "model",
  "effort",
  "context",
  "agent",
  "background",
  "hooks",
  "paths",
  "shell",
  "metadata",
  "license",
  "compatibility",
  ...Object.keys(directoryFields),
];
