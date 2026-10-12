import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { searchForWorkspaceRoot } from "vite";

const harnessDir = path.resolve(process.env.HH_HARNESS_DIR ?? path.join(__dirname, "../../harnesses/demo"));
// `humanharness dev --build <dir>`: the build goes to <dir>/{main,preload,renderer} instead of out/.
const outDir = process.env.HH_OUT_DIR ? path.resolve(process.env.HH_OUT_DIR) : undefined;
const out = (part: string) => (outDir ? { outDir: path.join(outDir, part) } : {});
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
      ...out("main"),
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
    build: { ...out("preload"), externalizeDeps: { exclude: ["@humanharness/ui"] } },
  },
  renderer: {
    root: path.join(__dirname, "src/renderer"),
    plugins: [react()],
    resolve: {
      alias: { "@harness/ui": path.join(harnessDir, "ui/App.tsx") },
      // A harness repo depends only on @humanharness/cli: its UI uses the shell's React and i18n, one copy each.
      dedupe: ["react", "react-dom", "react-i18next", "i18next", "@humanharness/ui"],
    },
    // The dev server may serve the harness folder, which may live outside this repository.
    server: { fs: { allow: [searchForWorkspaceRoot(__dirname), harnessDir] } },
    build: { ...out("renderer"), rollupOptions: { input: path.join(__dirname, "src/renderer/index.html") } },
  },
});
