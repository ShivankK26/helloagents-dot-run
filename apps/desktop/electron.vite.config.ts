import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

// The engine is a workspace package shipped as TypeScript source, so it has to
// be bundled into the main process rather than loaded from node_modules.
const bundleEngine = { externalizeDeps: { exclude: ["@helloagents/engine"] } };

export default defineConfig({
  main: { build: bundleEngine },
  preload: { build: bundleEngine },
  renderer: { plugins: [react()] },
});
