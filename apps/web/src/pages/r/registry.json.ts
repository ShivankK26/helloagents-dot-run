import type { APIRoute } from "astro";
import { getIndex } from "../../lib/registry";

export const GET: APIRoute = async () =>
  new Response(`${JSON.stringify(await getIndex(), null, 2)}\n`, {
    headers: { "content-type": "application/json; charset=utf-8" },
  });
