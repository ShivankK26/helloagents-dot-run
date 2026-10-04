// Builds the live demo for the website: the app's window code plus a pretend
// backend (src/demo), output into the site's public folder.
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("./src/demo"),
  base: "./",
  plugins: [react()],
  build: { outDir: here("../web/public/demo"), emptyOutDir: true },
});
