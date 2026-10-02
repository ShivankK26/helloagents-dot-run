import { expect, test } from "vitest";
import { loadShellPath, parseShellPath } from "../src/index";

test("extracts PATH from between the markers, ignoring rc-file noise", () => {
  const out =
    "Welcome back!\n__HELLOAGENTS_PATH__/Users/me/.local/bin:/usr/bin__HELLOAGENTS_PATH__\n";
  expect(parseShellPath(out)).toBe("/Users/me/.local/bin:/usr/bin");
});

test("returns undefined when the shell printed nothing usable", () => {
  expect(parseShellPath("")).toBeUndefined();
  expect(parseShellPath("__HELLOAGENTS_PATH____HELLOAGENTS_PATH__")).toBeUndefined();
});

test("does nothing on Windows", async () => {
  expect(await loadShellPath({}, "win32")).toBeUndefined();
});

test("reads the PATH from a real login shell", async () => {
  const path = await loadShellPath({ SHELL: "/bin/sh" });
  expect(path).toContain("/bin");
});
