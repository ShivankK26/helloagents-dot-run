import type { TokenUsage } from "@helloagents/engine/types";

/** 1234 → "1.2k", 1234567 → "1.2M". */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

/**
 * Splits usage into new tokens and cache re-reads. Each turn re-reads the whole
 * conversation from cache, so adding those in makes a short run look huge;
 * they're also far cheaper and count much less against plan limits.
 */
export function tokenParts(u: TokenUsage): { fresh: number; cached: number } {
  return { fresh: u.inputTokens + u.outputTokens + u.cacheWriteTokens, cached: u.cacheReadTokens };
}

export function ms(n: number): string {
  if (n < 1000) return `${Math.round(n)}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  return `${Math.floor(n / 60_000)}m ${String(Math.round((n % 60_000) / 1000)).padStart(2, "0")}s`;
}
