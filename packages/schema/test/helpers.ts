import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach } from "vitest";

const created: string[] = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

export async function tempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "helloagents-schema-"));
  created.push(dir);
  return dir;
}

/** Creates `<tmp>/registry` with the given files. A value of `{ symlink }` creates a link. */
export async function makeRegistry(
  files: Record<string, string | Buffer | { symlink: string }>,
): Promise<string> {
  const root = path.join(await tempDir(), "registry");
  await mkdir(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const dest = path.join(root, rel);
    await mkdir(path.dirname(dest), { recursive: true });
    if (typeof content === "object" && !Buffer.isBuffer(content)) {
      await symlink(content.symlink, dest);
    } else {
      await writeFile(dest, content);
    }
  }
  return root;
}

export function agent(name: string, extra = "", body = "You are a helpful sub-agent."): string {
  return `---\nname: ${name}\ndescription: Does ${name} things.\n${extra}---\n\n${body}\n`;
}

export function skill(name: string, extra = "", body = "Follow these steps."): string {
  return `---\nname: ${name}\ndescription: Helps with ${name}.\n${extra}---\n\n${body}\n`;
}
