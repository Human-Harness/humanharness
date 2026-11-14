import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shellResourcesDir } from "../src/main/shell-resources";

const shell = path.resolve(__dirname, "..");

// The shell's resources (the plugin and tool hosts' pages, scripts and preloads, the Dock icon) were found at
// `<main>/../../resources`: right for out/main, wrong for a build into HH_OUT_DIR=<x> (`humanharness dev --build`, the
// e2e builds), where it named `<x>/../resources`. The folder is now the one the build names, or the packaged app's.
describe("the shell's resources folder", () => {
  it("a development build reads the folder its build named (packages/shell/resources), wherever main was built", () => {
    const built = path.join(shell, "resources");
    expect(shellResourcesDir({ packaged: false, resourcesPath: "/App.app/Contents/Resources", built })).toBe(built);
  });

  it("a packaged app reads its own resources folder (process.resourcesPath), never a path baked in at build time", () => {
    expect(shellResourcesDir({ packaged: true, resourcesPath: "/App.app/Contents/Resources", built: "/build/machine/resources" })).toBe(
      "/App.app/Contents/Resources",
    );
  });

  it("the build names packages/shell/resources as __SHELL_RESOURCES__ for the main process", async () => {
    const config = await fs.readFile(path.join(shell, "electron.vite.config.ts"), "utf8");
    expect(config).toContain('__SHELL_RESOURCES__: JSON.stringify(path.join(__dirname, "resources"))');
  });

  it("main finds the plugin host, tool host and Dock icon files through it, never relative to the built main", async () => {
    // index.ts and app-lifecycle.ts, which holds its start-up blocks.
    const index = (await Promise.all(["index.ts", "app-lifecycle.ts"].map((f) => fs.readFile(path.join(shell, "src/main", f), "utf8")))).join("\n");
    expect(index).not.toContain("../../resources");
    expect(index).toContain("shellResourcesDir({ packaged: app.isPackaged, resourcesPath: process.resourcesPath, built: __SHELL_RESOURCES__ })");
    expect([...index.matchAll(/resources: shellResources\b/g)]).toHaveLength(2);
    expect(index).toContain('path.join(shellResources, "hh-logo.png")');
  });
});
