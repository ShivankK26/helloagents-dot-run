// @ts-check
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sitemap from "@astrojs/sitemap";
import { defineConfig, fontProviders } from "astro/config";

const require = createRequire(import.meta.url);
// `geist` only exports its Next.js loaders, so locate the font files via the package folder.
const geistFonts = path.join(path.dirname(require.resolve("geist/font")), "fonts");
const registryDir = fileURLToPath(new URL("../../registry", import.meta.url));

export default defineConfig({
  site: "https://helloagents.run",
  output: "static",
  trailingSlash: "ignore",
  build: { format: "directory" },
  integrations: [sitemap()],
  fonts: [
    {
      provider: fontProviders.local(),
      name: "Geist",
      cssVariable: "--font-geist",
      fallbacks: ["ui-sans-serif", "system-ui", "sans-serif"],
      options: {
        variants: [
          {
            src: [path.join(geistFonts, "geist-sans/Geist-Variable.woff2")],
            weight: "100 900",
            style: "normal",
          },
        ],
      },
    },
    {
      provider: fontProviders.local(),
      name: "Geist Mono",
      cssVariable: "--font-geist-mono",
      fallbacks: ["ui-monospace", "monospace"],
      options: {
        variants: [
          {
            src: [path.join(geistFonts, "geist-mono/GeistMono-Variable.woff2")],
            weight: "100 900",
            style: "normal",
          },
        ],
      },
    },
  ],
  vite: {
    define: { __REGISTRY_DIR__: JSON.stringify(registryDir) },
    server: { watch: { ignored: ["!**/registry/**"] } },
  },
});
