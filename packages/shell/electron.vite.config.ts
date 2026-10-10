import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";

const harnessDir = path.resolve(process.env.HH_HARNESS_DIR ?? path.join(__dirname, "../../harnesses/demo"));
// Workspace packages ship TypeScript source, so they are bundled; other dependencies stay external.
const workspacePackages = [
  "@humanharness/blocks",
  "@humanharness/engines",
  "@humanharness/harness-sdk",
  "@humanharness/runtime",
  "@humanharness/workspace",
  "@humanharness/ui",
];

export default defineConfig({
  main: {
    define: { __HARNESS_DIR__: JSON.stringify(harnessDir) },
    build: {
      externalizeDeps: { exclude: workspacePackages },
      // Entries go in `lib.entry`, not `rollupOptions.input`: with Vite 8, a user `rollupOptions`
      // makes electron-vite 5's presets (externals, output format, file names) get ignored.
      lib: {
        entry: {
          index: path.join(__dirname, "src/main/index.ts"),
          "ui-server": path.join(__dirname, "../blocks/src/ui-server-bin.ts"),
          harness: path.join(harnessDir, "harness.config.ts"),
        },
      },
    },
  },
  // The preload entry is the default src/preload/index.ts (see the note above).
  preload: {
    build: { externalizeDeps: { exclude: ["@humanharness/ui"] } },
  },
  renderer: {
    root: path.join(__dirname, "src/renderer"),
    plugins: [react()],
    resolve: { alias: { "@harness/ui": path.join(harnessDir, "ui/App.tsx") } },
    build: { rollupOptions: { input: path.join(__dirname, "src/renderer/index.html") } },
  },
});
