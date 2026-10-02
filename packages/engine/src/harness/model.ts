import Anthropic from "@anthropic-ai/sdk";

type Message = Anthropic.Beta.BetaMessage;

export interface ModelRequest {
  system: string;
  tools: Anthropic.Beta.BetaTool[];
  messages: Anthropic.Beta.BetaMessageParam[];
  signal?: AbortSignal;
}

/** One call to a model. The loop only depends on this, so tests can swap in a scripted model. */
export interface ModelClient {
  readonly model: string;
  turn(request: ModelRequest): Promise<Message>;
}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicModelOptions {
  model?: string;
  effort?: Effort;
  client?: Anthropic;
}

export const DEFAULT_MODEL = "claude-opus-5";

/** The real thing: streams one turn from the Claude API. */
export class AnthropicModel implements ModelClient {
  readonly model: string;
  private readonly effort: Effort;
  private readonly client: Anthropic;

  constructor({ model = DEFAULT_MODEL, effort = "high", client }: AnthropicModelOptions = {}) {
    this.model = model;
    this.effort = effort;
    // Resolves credentials the standard way: ANTHROPIC_API_KEY, or an `ant auth login` profile.
    this.client = client ?? new Anthropic();
  }

  async turn({ system, tools, messages, signal }: ModelRequest): Promise<Message> {
    // With eager input streaming, a tool input the SDK can't parse at all
    // rejects finalMessage(). Re-issue that turn a couple of times; real API
    // errors (auth, rate limits) are rethrown immediately.
    for (let attempt = 0; ; attempt++) {
      const stream = this.client.beta.messages.stream(
        {
          model: this.model,
          // Streaming, so a large cap is safe. It covers thinking plus output.
          max_tokens: 64_000,
          thinking: { type: "adaptive" },
          output_config: { effort: this.effort },
          // Stable prefix (system + tools) gets its own breakpoint; the
          // top-level setting caches the growing conversation tail.
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          cache_control: { type: "ephemeral" },
          tools,
          messages,
          // If a safety classifier declines, retry on Anthropic's recommended
          // fallback model instead of failing the run.
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
        },
        { signal },
      );
      try {
        return await stream.finalMessage();
      } catch (error) {
        if (error instanceof Anthropic.APIError || signal?.aborted || attempt >= 2) throw error;
      }
    }
  }
}

/**
 * Replays canned responses in order, and records what it was asked. Used by
 * tests so the loop can be exercised without network access or cost.
 */
export class ScriptedModel implements ModelClient {
  readonly model = "claude-opus-5";
  readonly requests: ModelRequest[] = [];
  private index = 0;

  constructor(private readonly script: Array<Message | ((req: ModelRequest) => Message)>) {}

  async turn(request: ModelRequest): Promise<Message> {
    // Snapshot: the loop keeps appending to the same array.
    this.requests.push({ ...request, messages: structuredClone(request.messages) });
    const next = this.script[this.index++];
    if (!next) throw new Error(`ScriptedModel ran out of responses after ${this.index - 1} turns`);
    return typeof next === "function" ? next(request) : next;
  }
}

let ids = 0;
/** Builds a response message for ScriptedModel. */
export function reply(opts: {
  text?: string;
  tools?: Array<{ name: string; input: unknown; id?: string }>;
  stop?: Message["stop_reason"];
  usage?: Partial<Message["usage"]>;
  model?: string;
}): Message {
  const content: unknown[] = [];
  if (opts.text) content.push({ type: "text", text: opts.text, citations: null });
  for (const t of opts.tools ?? []) {
    content.push({ type: "tool_use", id: t.id ?? `toolu_${++ids}`, name: t.name, input: t.input });
  }
  return {
    id: `msg_${++ids}`,
    type: "message",
    role: "assistant",
    model: opts.model ?? "claude-opus-5",
    content,
    stop_reason: opts.stop ?? (opts.tools?.length ? "tool_use" : "end_turn"),
    stop_sequence: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      ...opts.usage,
    },
  } as unknown as Message;
}
