// Renders the PNG brand assets in apps/web/public/ with headless Google Chrome.
// Usage: node scripts/brand-assets.mjs   (set CHROME=/path/to/chrome if it isn't found)
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const chrome =
  process.env.CHROME ??
  (process.platform === "darwin"
    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
    : "google-chrome");
const tmp = mkdtempSync(path.join(tmpdir(), "helloagents-brand-"));

function shot(url, width, height, out) {
  execFileSync(
    chrome,
    [
      "--headless=new",
      "--disable-gpu",
      "--hide-scrollbars",
      "--virtual-time-budget=4000",
      `--window-size=${width},${height}`,
      `--screenshot=${path.join(root, out)}`,
      url,
    ],
    { stdio: "ignore" },
  );
  console.log(`✔ ${out}`);
}

const icon = readFileSync(path.join(root, "docs/brand/app-icon.svg"), "utf8");
for (const size of [180, 512]) {
  const file = path.join(tmp, `icon-${size}.html`);
  writeFileSync(
    file,
    `<body style="margin:0">${icon.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`,
  );
  shot(
    `file://${file}`,
    size,
    size,
    size === 180 ? "apps/web/public/apple-touch-icon.png" : "apps/web/public/icon-512.png",
  );
}
shot(
  `file://${path.join(root, "docs/brand/og-image.html")}`,
  1200,
  630,
  "apps/web/public/og-image.png",
);
