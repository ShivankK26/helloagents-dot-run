import { expect, test } from "vitest";
import { costOf, priceFor } from "../src/index";

test("Opus 5 at $5 / $25 per million, with cache rates", () => {
  expect(
    costOf("claude-opus-5", {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
  ).toBeCloseTo(5);
  expect(
    costOf("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
  ).toBeCloseTo(25);
  expect(
    costOf("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
    }),
  ).toBeCloseTo(0.5);
  expect(
    costOf("claude-opus-5", {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 1_000_000,
    }),
  ).toBeCloseTo(6.25);
});

test("unknown models cost 0 rather than a guess", () => {
  expect(priceFor("some-other-model")).toBeUndefined();
  expect(
    costOf("some-other-model", {
      inputTokens: 5,
      outputTokens: 5,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    }),
  ).toBe(0);
});
