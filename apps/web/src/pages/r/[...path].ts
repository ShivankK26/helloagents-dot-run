import type { APIRoute, GetStaticPaths } from "astro";
import { getEntries, type LoadedFile } from "../../lib/registry";

/** Raw entry files at /r/agents/<name>.md and /r/skills/<name>/<file>, for the CLI. */
export const getStaticPaths = (async () => {
  const entries = await getEntries();
  return entries.flatMap((entry) =>
    entry.files.map((file) => ({ params: { path: file.path }, props: { file } })),
  );
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) => {
  const { file } = props as { file: LoadedFile };
  const type = file.text === undefined ? "application/octet-stream" : "text/plain; charset=utf-8";
  return new Response(new Uint8Array(file.data), { headers: { "content-type": type } });
};
