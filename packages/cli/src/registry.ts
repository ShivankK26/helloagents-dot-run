import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RegistryEntry, RegistryFile, RegistryIndex } from "@helloagents/schema";
import type { Io } from "./io.js";
import { CliError } from "./output.js";

export type { RegistryEntry, RegistryFile, RegistryIndex };

export const DEFAULT_REGISTRY_URL = "https://helloagents.run/r";
export const REGISTRY_ENV = "HELLOAGENTS_REGISTRY_URL";
const SUPPORTED_VERSION = 1;
const TIMEOUT_MS = 20_000;

const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]*$/;

export function registryBase(io: Io): string {
  return (io.env[REGISTRY_ENV]?.trim() || DEFAULT_REGISTRY_URL).replace(/\/+$/, "");
}

/**
 * Reads a file from the registry. The base may be an http(s) URL, a file://
 * URL, or a local folder (handy for testing against `pnpm registry:build`).
 */
async function read(io: Io, relPath: string): Promise<Buffer> {
  const base = registryBase(io);
  if (!/^https?:\/\//i.test(base)) {
    const dir = base.startsWith("file:") ? fileURLToPath(base) : path.resolve(io.cwd, base);
    const file = path.join(dir, ...relPath.split("/"));
    try {
      return await readFile(file);
    } catch (error) {
      throw new CliError(`Couldn't read ${file} from the local registry (${errorCode(error)}).`);
    }
  }

  const url = `${base}/${relPath}`;
  let response: Response;
  try {
    response = await io.fetch(url, {
      headers: { accept: "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "TimeoutError" ? "timed out" : describe(error);
    throw new CliError(
      `Couldn't reach the registry at ${base} (${reason}).\nCheck your internet connection, or set ${REGISTRY_ENV} to use a different registry.`,
    );
  }
  if (!response.ok) {
    throw new CliError(`The registry returned HTTP ${response.status} for ${url}.`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function fetchIndex(io: Io): Promise<RegistryIndex> {
  const raw = await read(io, "registry.json");
  let data: unknown;
  try {
    data = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new CliError(
      `The registry at ${registryBase(io)} returned invalid JSON for registry.json.`,
    );
  }
  return parseIndex(data, registryBase(io));
}

/** Checks registry.json defensively: it decides which paths we write to. */
export function parseIndex(data: unknown, source: string): RegistryIndex {
  const bad = (why: string) => new CliError(`The registry at ${source} is malformed: ${why}.`);
  if (!isRecord(data) || !Array.isArray(data.entries) || typeof data.version !== "number") {
    throw bad("expected { version, entries }");
  }
  if (data.version > SUPPORTED_VERSION) {
    throw new CliError(
      `The registry uses format version ${data.version}, but this CLI only understands version ${SUPPORTED_VERSION}.\nUpdate with: npx @helloagents/cli@latest`,
    );
  }
  const entries = data.entries.map((e: unknown, i): RegistryEntry => {
    if (!isRecord(e) || typeof e.name !== "string" || !NAME.test(e.name))
      throw bad(`entry ${i} has an invalid name`);
    if (e.type !== "agent" && e.type !== "skill")
      throw bad(`entry "${e.name}" has an invalid type`);
    if (typeof e.description !== "string") throw bad(`entry "${e.name}" has no description`);
    if (!Array.isArray(e.files) || e.files.length === 0)
      throw bad(`entry "${e.name}" has no files`);
    const files = e.files.map((f: unknown): RegistryFile => {
      if (
        !isRecord(f) ||
        typeof f.path !== "string" ||
        typeof f.sha256 !== "string" ||
        typeof f.size !== "number"
      ) {
        throw bad(`entry "${e.name}" has an invalid file`);
      }
      if (!isSafePath(e.type as RegistryEntry["type"], e.name as string, f.path)) {
        throw bad(`entry "${e.name}" has an unsafe file path "${f.path}"`);
      }
      return { path: f.path, size: f.size, sha256: f.sha256 };
    });
    return {
      name: e.name,
      type: e.type,
      description: e.description,
      ...(typeof e.category === "string" && { category: e.category }),
      tags: Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === "string") : [],
      ...(typeof e.author === "string" && { author: e.author }),
      files,
    };
  });
  return { version: data.version, entries };
}

/** Agents ship exactly agents/<name>.md; skills ship files under skills/<name>/. */
export function isSafePath(type: RegistryEntry["type"], name: string, filePath: string): boolean {
  if (type === "agent") return filePath === `agents/${name}.md`;
  const prefix = `skills/${name}/`;
  if (!filePath.startsWith(prefix)) return false;
  const segments = filePath.slice(prefix.length).split("/");
  return segments.every((s) => SEGMENT.test(s) && s !== "." && s !== "..");
}

export async function fetchFile(io: Io, file: RegistryFile): Promise<Buffer> {
  const data = await read(io, file.path);
  const sha = createHash("sha256").update(data).digest("hex");
  if (sha !== file.sha256) {
    throw new CliError(
      `Downloaded ${file.path} doesn't match the registry checksum. The registry may be mid-deploy; try again in a minute.`,
    );
  }
  return data;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as Error & { cause?: unknown }).cause;
    const code = errorCode(cause);
    return code !== "unknown error" ? code : error.message;
  }
  return String(error);
}

function errorCode(error: unknown): string {
  if (isRecord(error) && typeof error.code === "string") return error.code;
  if (error instanceof Error) return error.message;
  return "unknown error";
}
