import type { TokenUsage } from "../types";

/** US dollars per million tokens. */
interface Price {
  input: number;
  output: number;
}

// First-party API list prices. Cache writes (5-minute) cost 1.25× input and
// cache reads 0.1× input.
const PRICES: Record<string, Price> = {
  "claude-fable-5-1": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

export function priceFor(model: string): Price | undefined {
  return PRICES[model] ?? PRICES[Object.keys(PRICES).find((m) => model.startsWith(m)) ?? ""];
}

/** Estimated cost of one response. Unknown models are priced at 0 rather than guessed. */
export function costOf(model: string, usage: TokenUsage): number {
  const price = priceFor(model);
  if (!price) return 0;
  const perToken = (dollarsPerMillion: number) => dollarsPerMillion / 1_000_000;
  return (
    usage.inputTokens * perToken(price.input) +
    usage.cacheWriteTokens * perToken(price.input * 1.25) +
    usage.cacheReadTokens * perToken(price.input * 0.1) +
    usage.outputTokens * perToken(price.output)
  );
}

export function addUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
};
