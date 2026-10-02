export const ENGINE_VERSION = "0.1.0";

export { detectClaudeCode, runCommand } from "./environment";
export type { RunCommand } from "./environment";
export { loadShellPath, parseShellPath } from "./shell-path";
export type * from "./types";

export { runAgent } from "./harness/agent";
export type { AgentOptions, AgentResult } from "./harness/agent";
export { AnthropicModel, DEFAULT_MODEL, ScriptedModel, reply } from "./harness/model";
export type { Effort, ModelClient, ModelRequest } from "./harness/model";
export { costOf, priceFor } from "./harness/pricing";
export { DEFAULT_ALLOWED_COMMANDS, runTool, safeEnv, toolDefinitions } from "./harness/tools";
export { resolveInside } from "./harness/workspace";
