import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { formatIssues, loadRegistry } from "../src/index.js";

const REGISTRY = fileURLToPath(new URL("../../../registry", import.meta.url));

test("the repository registry is valid", async () => {
  const { entries, issues } = await loadRegistry(REGISTRY);
  if (issues.length > 0) expect.fail(formatIssues(issues));
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry.category, `${entry.name} should have a category`).toBeDefined();
    expect(entry.body.length, `${entry.name} should have a substantial prompt`).toBeGreaterThan(
      400,
    );
  }
});
