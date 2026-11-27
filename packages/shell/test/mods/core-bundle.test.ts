import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN_SHARED_MODULES } from "@humanharness/mod-sdk/bundle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCoreMods } from "../../src/main/mods/bundle";
import { ModHost } from "../../src/main/mods/host";

let tmp: string;
beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "hh-core-"));
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

async function fixture(id: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    const file = path.join(tmp, "mods", id, rel);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, text);
  }
}

describe("core mods' main in the built app", () => {
  it("copies mod.json, README and src, bundles main, and the host loads it", async () => {
    await fixture("pinger", {
      "mod.json": JSON.stringify({ id: "pinger", name: "Pinger", version: "0.1.0", apiVersion: 1, main: "main.js" }),
      "README.md": "# Pinger\n",
      "package.json": JSON.stringify({ name: "@humanharness/mod-pinger", dependencies: { "@humanharness/mod-sdk": "workspace:*" } }),
      "src/main.ts":
        "import path from 'node:path';\nimport { defineMod } from '@humanharness/mod-sdk';\nimport { word } from './word';\nexport default defineMod({ id: 'pinger', main(ctx) { ctx.ipc('ping',() => word + path.sep); } });\n",
      "src/word.ts": "export const word = 'pong';\n",
    });
    const dest = path.join(tmp, "out", "core-mods");
    await buildCoreMods(path.join(tmp, "mods"), dest, ["pinger"]);
    for (const f of ["mod.json", "README.md", "src/main.ts", "main.js"]) expect(await fs.stat(path.join(dest, "pinger", f)).catch(() => null)).not.toBeNull();

    (globalThis as { __hhMainModules?: unknown }).__hhMainModules = MAIN_SHARED_MODULES;
    const h = new ModHost({
      config: { load: async () => undefined, saveFailed: vi.fn(async () => {}) },
      services: () => ({}),
      notice: vi.fn(),
      changed: vi.fn(),
      coreOn: () => true,
    });
    const json = JSON.parse(await fs.readFile(path.join(dest, "pinger", "mod.json"), "utf8"));
    await h.start([{ json: { requires: [], history: false, ...json }, dir: path.join(dest, "pinger"), origin: "core", shipped: "core", config: undefined }]);
    expect(h.view()[0], JSON.stringify(h.view()[0])).toMatchObject({ id: "pinger", on: true });
    expect(await h.call("pinger", "ping", undefined)).toBe(`pong${path.sep}`);
  });

  it("a core mod with no main is only copied; a refused import fails the build", async () => {
    await fixture("plain", { "mod.json": JSON.stringify({ id: "plain", name: "Plain", version: "0.1.0", apiVersion: 1 }) });
    await fixture("bad", {
      "mod.json": JSON.stringify({ id: "bad", name: "Bad", version: "0.1.0", apiVersion: 1, main: "main.js" }),
      "src/main.ts": "import 'undeclared';\nexport default {};\n",
    });
    const dest = path.join(tmp, "out", "core-mods");
    await buildCoreMods(path.join(tmp, "mods"), dest, ["plain"]);
    expect(await fs.readdir(path.join(dest, "plain"))).toEqual(["mod.json"]);
    await expect(buildCoreMods(path.join(tmp, "mods"), dest, ["bad"])).rejects.toThrow(/core mod "bad".*undeclared can't be imported by a core mod/s);
  });
});

describe("the core does not import a core mod", () => {
  const repo = path.resolve(import.meta.dirname, "../../..");
  const PACKAGES = ["shell", "protocol", "runtime", "workspace", "harness-sdk", "ui"];
  /** The one exception: the window draws Home from its static ui import (minimal-core 0b1). */
  const ALLOWED = new Set(["shell/src/renderer/main.tsx → @humanharness/mod-home", "shell/src/renderer/main.tsx → @humanharness/mod-history-view", "shell/src/renderer/main.tsx → @humanharness/mod-sidekick", "shell/src/renderer/main.tsx → @humanharness/mod-usage"]);
  const IMPORT = /(?:from\s+|import\s*\(\s*|import\s+|require\s*\(\s*)["'](@humanharness\/mod-[a-z0-9-]+)/g;

  async function sources(dir: string): Promise<string[]> {
    const entries = await fs.readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
    return entries
      .filter((e) => e.isFile() && /\.(ts|tsx|mts|js|mjs)$/.test(e.name))
      .map((e) => path.join(e.parentPath, e.name))
      .filter((f) => !/[/\\](node_modules|out|dist|test)[/\\]/.test(path.relative(repo, f)));
  }

  it("no package under shell, protocol, runtime, workspace, harness-sdk or ui imports @humanharness/mod-*", async () => {
    const found: string[] = [];
    for (const p of PACKAGES) {
      for (const file of await sources(path.join(repo, p))) {
        const text = await fs.readFile(file, "utf8");
        for (const m of text.matchAll(IMPORT)) {
          if (m[1] === "@humanharness/mod-sdk") continue;
          const line = `${path.relative(repo, file).split(path.sep).join("/")} → ${m[1]}`;
          if (!ALLOWED.has(line)) found.push(line);
        }
      }
    }
    expect(found).toEqual([]);
  });

  it("the scan sees an import", () => {
    const text = 'import x from "@humanharness/mod-sidekick";\nconst y = await import("@humanharness/mod-a/main");';
    expect([...text.matchAll(IMPORT)].map((m) => m[1])).toEqual(["@humanharness/mod-sidekick", "@humanharness/mod-a"]);
  });
});
