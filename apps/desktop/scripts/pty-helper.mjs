// node-pty's prebuilt spawn-helper ships without its executable bit, and the
// terminal can't start a shell without it. Set it before packaging.
import { chmodSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.dirname(createRequire(import.meta.url).resolve("node-pty/package.json"));
for (const arch of ["arm64", "x64"]) {
  const helper = path.join(root, "prebuilds", `darwin-${arch}`, "spawn-helper");
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
