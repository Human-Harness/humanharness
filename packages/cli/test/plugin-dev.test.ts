import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { UsageError } from "../src/cli";
import type { DevSpawn } from "../src/dev";
import { initHarness } from "../src/init";
import { main } from "../src/main";
import { PLUGIN_USAGE } from "../src/plugin";
import { type PluginWatch, ignoredChange, pluginDevCommand } from "../src/plugin-dev";
import { initPlugin } from "../src/plugin-init";
import { CORE, memoryIo, memoryStream, replaceIn, tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-plugin-dev-");
afterAll(cleanup);

const plugin = path.join(root, "my-items");
const harness = path.join(root, "harness");

beforeAll(async () => {
  await initPlugin({ dir: plugin, core: CORE, log: () => {} });
  await initHarness({ dir: harness, core: CORE, install: false });
}, 60_000);

/** A spawn that records its call and exits only when `exit` is called. */
function heldSpawn() {
  const calls: { args: string[]; env?: NodeJS.ProcessEnv }[] = [];
  const child = new EventEmitter();
  const spawn: DevSpawn = (_command, args, options) => {
    calls.push({ args, env: options.env });
    return child;
  };
  return { spawn, calls, exit: (code = 0) => child.emit("exit", code) };
}

/** A watcher the test drives: `change(file)` is what fs.watch would report. */
function fakeWatch() {
  const state = { started: 0, closed: 0, dir: "", listener: null as ((file: string | null) => void) | null };
  const watch: PluginWatch = (dir, onChange) => {
    state.started++;
    state.dir = dir;
    state.listener = onChange;
    return { close: () => void state.closed++ };
  };
  return { watch, state, change: (file: string | null) => state.listener?.(file) };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until the fake app has been spawned (the check and build ran). */
async function spawned(calls: unknown[]) {
  for (let i = 0; i < 600 && calls.length === 0; i++) await wait(25);
  expect(calls).toHaveLength(1);
}

describe("humanharness plugin dev", () => {
  it("opens the harness with the plugin as a dev plugin on its fixtures", async () => {
    const s = heldSpawn();
    const w = fakeWatch();
    const out = memoryStream();
    const done = pluginDevCommand({ pluginDir: plugin, harnessDir: harness, out: out.stream, spawn: s.spawn, watch: w.watch });
    await spawned(s.calls);
    expect(s.calls[0].args).toEqual(["dev"]);
    expect(s.calls[0].env).toMatchObject({ HH_HARNESS_DIR: harness, HH_PLUGIN_DIRS: plugin, HH_PLUGIN_FIXTURES: "1" });
    expect(out.text()).not.toContain("Live:");
    expect(w.state).toMatchObject({ started: 1, closed: 0, dir: plugin });
    s.exit(0);
    expect(await done).toBe(0);
    expect(w.state.closed).toBe(1);
  }, 60_000);

  it("--live drops the fixtures and says which hosts the plugin will reach with the keys", async () => {
    const s = heldSpawn();
    const out = memoryStream();
    process.env.HH_PLUGIN_FIXTURES = "1";
    try {
      const done = pluginDevCommand({ pluginDir: plugin, harnessDir: harness, live: true, out: out.stream, spawn: s.spawn, watch: fakeWatch().watch });
      await spawned(s.calls);
      expect(s.calls[0].env?.HH_PLUGIN_DIRS).toBe(plugin);
      // A stray HH_PLUGIN_FIXTURES in the developer's shell would turn --live back into fixtures.
      expect(s.calls[0].env?.HH_PLUGIN_FIXTURES).toBeUndefined();
      expect(out.text()).toContain("Live: this plugin will reach api.example.com with your keys from Settings › Plugins.");
      s.exit(0);
      expect(await done).toBe(0);
    } finally {
      delete process.env.HH_PLUGIN_FIXTURES;
    }
  }, 60_000);

  it("rebuilds once, 300 ms after the last change, and ignores dist/, fixtures/, node_modules/ and dot-folders", async () => {
    const s = heldSpawn();
    const w = fakeWatch();
    const builds: string[] = [];
    const out = memoryStream();
    const done = pluginDevCommand({
      pluginDir: plugin,
      harnessDir: harness,
      out: out.stream,
      spawn: s.spawn,
      watch: w.watch,
      rebuild: async (dir) => {
        builds.push(dir);
      },
    });
    await spawned(s.calls);
    for (const f of ["dist/plugin.json", "dist.tmp-ab12/backend.js", "dist.old-ab12", "fixtures/items/001.json", "node_modules/x/index.js", ".git/index", "panels/.cache/x", null]) w.change(f);
    await wait(450);
    expect(builds).toHaveLength(0);
    w.change("backend.ts");
    await wait(150);
    w.change("panels/main.tsx");
    await wait(200);
    expect(builds).toHaveLength(0);
    await wait(250);
    expect(builds).toEqual([plugin]);
    expect(out.text()).toContain("Rebuilt my-items.");
    s.exit(0);
    expect(await done).toBe(0);
  }, 60_000);

  it("a failed rebuild prints the error and keeps going; nothing runs after the app exits", async () => {
    const s = heldSpawn();
    const w = fakeWatch();
    let builds = 0;
    const out = memoryStream();
    const done = pluginDevCommand({
      pluginDir: plugin,
      harnessDir: harness,
      out: out.stream,
      spawn: s.spawn,
      watch: w.watch,
      rebuild: async () => {
        builds++;
        throw new Error("backend.ts:3: Unexpected token");
      },
    });
    await spawned(s.calls);
    w.change("backend.ts");
    await wait(400);
    expect(builds).toBe(1);
    expect(out.text()).toContain("The build failed; the app keeps the last good dist/: backend.ts:3: Unexpected token");
    // A change pending when the app closes never builds: the debounce timer is cleared with the watcher.
    w.change("backend.ts");
    s.exit(0);
    expect(await done).toBe(0);
    expect(w.state.closed).toBe(1);
    await wait(400);
    expect(builds).toBe(1);
  }, 60_000);

  it("the real watcher sees a source change, not a dist/ write, and stops with the app", async () => {
    const s = heldSpawn();
    let builds = 0;
    const done = pluginDevCommand({
      pluginDir: plugin,
      harnessDir: harness,
      out: memoryStream().stream,
      spawn: s.spawn,
      rebuild: async () => {
        builds++;
      },
    });
    await spawned(s.calls);
    await wait(200);
    fs.writeFileSync(path.join(plugin, "dist", "touched.txt"), "x");
    await wait(600);
    expect(builds).toBe(0);
    fs.appendFileSync(path.join(plugin, "panels", "main.tsx"), "\n");
    for (let i = 0; i < 40 && builds === 0; i++) await wait(50);
    expect(builds).toBe(1);
    s.exit(0);
    expect(await done).toBe(0);
    fs.appendFileSync(path.join(plugin, "backend.ts"), "\n");
    await wait(600);
    expect(builds).toBe(1);
    fs.rmSync(path.join(plugin, "dist", "touched.txt"));
  }, 60_000);

  it("a check error stops before the app opens and before anything is watched", async () => {
    const broken = path.join(root, "broken");
    fs.cpSync(plugin, broken, { recursive: true });
    fs.rmSync(path.join(broken, "backend.ts"));
    const s = heldSpawn();
    const w = fakeWatch();
    const out = memoryStream();
    expect(await pluginDevCommand({ pluginDir: broken, harnessDir: harness, out: out.stream, spawn: s.spawn, watch: w.watch })).toBe(1);
    expect(s.calls).toHaveLength(0);
    expect(w.state.started).toBe(0);
    expect(out.text()).toContain("backend.ts is missing");
    expect(out.text()).toContain("Fix the errors above before opening the app.");
  }, 60_000);

  it("a harness check error stops too, and nothing is watched", async () => {
    const bad = path.join(root, "bad-harness");
    fs.cpSync(harness, bad, { recursive: true });
    replaceIn(bad, "HARNESS.md", "- engines: claude, codex", "- engines: claude");
    const s = heldSpawn();
    const w = fakeWatch();
    const out = memoryStream();
    expect(await pluginDevCommand({ pluginDir: plugin, harnessDir: bad, out: out.stream, spawn: s.spawn, watch: w.watch })).toBe(1);
    expect(s.calls).toHaveLength(0);
    expect(w.state.started).toBe(0);
    expect(out.text()).toContain("harness-md-mismatch");
  }, 60_000);

  it("refuses --live with --mock: mock mode always plays the fixtures", async () => {
    await expect(pluginDevCommand({ pluginDir: plugin, harnessDir: harness, live: true, mock: true, out: memoryStream().stream })).rejects.toThrow(UsageError);
  });

  it("the command line needs --harness and takes --plugin", async () => {
    const m = memoryIo(plugin);
    expect(await main(["plugin", "dev"], m.io)).toBe(2);
    expect(m.err()).toContain("--harness <dir>");
    const help = memoryIo(root);
    expect(await main(["plugin", "dev", "--help"], help.io)).toBe(0);
    expect(help.out()).toContain("humanharness plugin dev --harness <dir>");
  });
});

describe("ignoredChange", () => {
  it("ignores the build's own output, the fixtures, dependencies, dot-folders and unknown names", () => {
    for (const f of ["dist", "dist/a.js", "dist.tmp-0f/a.js", "dist.old-0f", "fixtures/x/001.json", "node_modules/a", "lib/node_modules/a", ".git/HEAD", "a/.cache/b", null]) {
      expect(ignoredChange(f), String(f)).toBe(true);
    }
    for (const f of ["backend.ts", "plugin.config.ts", "panels/main.tsx", "assets/logo.svg", "PLUGIN.md", "distance.ts", "lib/x.ts"]) expect(ignoredChange(f), f).toBe(false);
  });
});

describe("PLUGIN_USAGE", () => {
  it("lists every plugin command, test and dev included", () => {
    for (const c of ["init <dir>", "build [--plugin <dir>]", "check [--json]", "record <source>", "test [--source <id>]", "dev --harness <dir>"]) expect(PLUGIN_USAGE).toContain(`  ${c}`);
  });
});
