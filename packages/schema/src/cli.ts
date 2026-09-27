import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { buildRegistry, formatIssues } from "./build.js";
import { loadRegistry } from "./load.js";

const USAGE = `Usage:
  node dist/cli.js validate [--registry <dir>]
  node dist/cli.js build --out <dir> [--registry <dir>]`;

// dist/cli.js -> repo root/registry
const DEFAULT_REGISTRY = fileURLToPath(new URL("../../../registry", import.meta.url));

async function main(): Promise<number> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { registry: { type: "string" }, out: { type: "string" } },
  });
  const command = positionals[0];
  const registryDir = path.resolve(values.registry ?? DEFAULT_REGISTRY);

  if (command === "validate") {
    const { entries, issues } = await loadRegistry(registryDir);
    if (issues.length > 0) {
      console.error(formatIssues(issues));
      return 1;
    }
    console.log(`✔ Registry is valid: ${summarize(entries)}`);
    return 0;
  }

  if (command === "build") {
    if (!values.out) {
      console.error(`--out is required\n\n${USAGE}`);
      return 2;
    }
    try {
      const index = await buildRegistry({ registryDir, outDir: values.out });
      console.log(`✔ Built registry: ${summarize(index.entries)} → ${path.resolve(values.out)}`);
      return 0;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      return 1;
    }
  }

  console.error(USAGE);
  return 2;
}

function summarize(entries: { type: string }[]): string {
  const agents = entries.filter((e) => e.type === "agent").length;
  const skills = entries.length - agents;
  return `${agents} sub-agent${agents === 1 ? "" : "s"}, ${skills} skill${skills === 1 ? "" : "s"}`;
}

process.exitCode = await main();
