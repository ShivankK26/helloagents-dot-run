import type Anthropic from "@anthropic-ai/sdk";
import type { AgentEvent, AgentStatus, TokenUsage, ToolCall } from "../types";
import type { ModelClient } from "./model";
import { addUsage, costOf, EMPTY_USAGE } from "./pricing";
import { taskMessage, WORKER_SYSTEM_PROMPT } from "./prompt";
import { DEFAULT_ALLOWED_COMMANDS, runTool, toolDefinitions } from "./tools";

export interface AgentOptions {
  task: string;
  /** Folder the agent works in. Every file path is confined to it. */
  workspace: string;
  model: ModelClient;
  /** Hard stop after this many model calls. */
  maxTurns?: number;
  /** Hard stop once estimated spend reaches this, in US dollars. */
  maxCostUsd?: number;
  allowedCommands?: readonly string[];
  signal?: AbortSignal;
  onEvent?: (event: AgentEvent) => void;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface AgentResult {
  status: AgentStatus;
  summary: string;
  turns: number;
  usage: TokenUsage;
  costUsd: number;
  error?: string;
}

type Block = Anthropic.Beta.BetaContentBlock;
type ToolResultParam = Anthropic.Beta.BetaToolResultBlockParam;

/** Runs one agent until it finishes, fails, or hits a limit. Emits an event for every step. */
export async function runAgent(opts: AgentOptions): Promise<AgentResult> {
  const { task, workspace, model, signal, maxTurns = 40, maxCostUsd = 5 } = opts;
  const now = opts.now ?? Date.now;
  const emit = opts.onEvent ?? (() => {});
  const ctx = {
    workspace,
    allowedCommands: opts.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS,
    signal,
  };
  const tools = toolDefinitions();
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    { role: "user", content: taskMessage(task) },
  ];

  let usage = EMPTY_USAGE;
  let costUsd = 0;
  let turns = 0;
  let lastText = "";

  emit({ type: "agent.start", at: now(), task, model: model.model, workspace });
  const end = (status: AgentStatus, summary: string, error?: string): AgentResult => {
    const result = { status, summary, turns, usage, costUsd, ...(error && { error }) };
    emit({ type: "agent.end", at: now(), ...result });
    return result;
  };

  try {
    while (true) {
      if (signal?.aborted) return end("cancelled", "Stopped by the user.");
      if (turns >= maxTurns)
        return end("budget", `Stopped after ${maxTurns} turns without finishing.`);
      if (costUsd >= maxCostUsd)
        return end("budget", `Stopped at the $${maxCostUsd.toFixed(2)} budget without finishing.`);

      turns++;
      const started = now();
      const response = await model.turn({ system: WORKER_SYSTEM_PROMPT, tools, messages, signal });

      const turnUsage: TokenUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
        cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
      };
      const turnCost = costOf(response.model, turnUsage);
      usage = addUsage(usage, turnUsage);
      costUsd += turnCost;

      const text = textOf(response.content);
      if (text) lastText = text;
      const toolCalls: ToolCall[] = response.content
        .filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use")
        .map((b) => ({ id: b.id, name: b.name, input: b.input }));

      emit({
        type: "model.response",
        at: now(),
        turn: turns,
        durationMs: now() - started,
        model: response.model,
        stopReason: response.stop_reason,
        text,
        toolCalls,
        usage: turnUsage,
        costUsd: turnCost,
      });

      // Check why the model stopped before using anything it produced.
      if (response.stop_reason === "refusal") {
        return end("refused", "The model declined this task, and no fallback model could take it.");
      }
      if (response.stop_reason === "model_context_window_exceeded") {
        return end("context_full", "The conversation outgrew the model's context window.");
      }

      // Always append the full content (thinking and tool_use blocks included):
      // the API expects history to be sent back unchanged.
      messages.push({ role: "assistant", content: response.content });

      if (toolCalls.length === 0) {
        return end("done", lastText || "The agent ended without a summary.");
      }

      // A tool input cut off at max_tokens can still parse as a smaller,
      // wrong object, so never run tools from a truncated turn.
      const truncated = response.stop_reason === "max_tokens";
      const results: ToolResultParam[] = [];
      let finished: string | undefined;
      for (const call of toolCalls) {
        const toolStarted = now();
        const outcome = truncated
          ? {
              ok: false,
              output:
                "Your response was cut off before this tool call was complete, so it wasn't run. Split large file writes into smaller edits.",
            }
          : await runTool(call.name, call.input, ctx);
        if (outcome.finished) finished = outcome.finished;
        emit({
          type: "tool.result",
          at: now(),
          turn: turns,
          id: call.id,
          name: call.name,
          input: call.input,
          ok: outcome.ok,
          output: outcome.output,
          durationMs: now() - toolStarted,
        });
        results.push({
          type: "tool_result",
          tool_use_id: call.id,
          content: outcome.output,
          ...(!outcome.ok && { is_error: true }),
        });
      }
      // All results go back in one message; splitting them teaches the model
      // to stop making parallel calls.
      messages.push({ role: "user", content: results });

      if (finished !== undefined) return end("done", finished);
    }
  } catch (error) {
    if (signal?.aborted) return end("cancelled", "Stopped by the user.");
    const message = error instanceof Error ? error.message : String(error);
    return end("error", "The run failed.", message);
  }
}

function textOf(content: Block[]): string {
  return content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n")
    .trim();
}
