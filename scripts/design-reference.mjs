// Regenerates docs/design-reference.html from the built home page, so the
// reference always matches the real design system (apps/web/src/styles/global.css).
// Usage: pnpm design:reference
import { readFile, readdir, writeFile } from "node:fs/promises";

const dist = new URL("../apps/web/dist/", import.meta.url);
let html = await readFile(new URL("index.html", dist), "utf8");

// Inline the built stylesheet(s).
for (const [tag, href] of html.matchAll(/<link rel="stylesheet" href="([^"]+)">/g)) {
  const css = await readFile(new URL(`.${href}`, dist), "utf8");
  html = html.replace(tag, `<style>${css}</style>`);
}
// Swap self-hosted fonts for Google Fonts so the file works on its own.
html = html
  .replace(/<style>@font-face\{font-family:"?Geist[^<]*<\/style>/g, "")
  .replace(/<link rel="preload"[^>]*as="font"[^>]*>/g, "")
  .replace(
    "</title>",
    `</title><link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap" rel="stylesheet"><style>:root{--font-geist:"Geist";--font-geist-mono:"Geist Mono"}</style>`,
  );

const banner = `<!--
  helloagents.run design reference.
  Generated from the built site by scripts/design-reference.mjs. Do not edit by hand:
  change apps/web/src/styles/global.css or the Astro components, then run pnpm design:reference.
  Open this file directly in a browser. Search falls back to the rows on the page.
-->
`;
await writeFile(new URL("../docs/design-reference.html", import.meta.url), banner + html);
const count = (await readdir(new URL("_astro/", dist))).length;
console.log(`✔ Wrote docs/design-reference.html (${count} built assets inlined or replaced)`);
