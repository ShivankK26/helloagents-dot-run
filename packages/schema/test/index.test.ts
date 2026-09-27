import { expect, test } from "vitest";
import { REGISTRY_FORMAT_VERSION } from "../src/index.js";

test("exports a format version", () => {
  expect(REGISTRY_FORMAT_VERSION).toBe(1);
});
