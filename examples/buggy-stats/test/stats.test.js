import assert from "node:assert/strict";
import { test } from "node:test";
import { mean, median, range } from "../src/stats.js";

test("mean", () => {
  assert.equal(mean([1, 2, 3, 4]), 2.5);
  assert.ok(Number.isNaN(mean([])));
});

test("median sorts first", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test("range", () => {
  assert.equal(range([5, -2, 9]), 11);
});
