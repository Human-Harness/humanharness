import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MAIN_SHARED_MODULES } from "@humanharness/mod-sdk/bundle";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type ModsSettings, cleanModsConfig } from "../src/main/mods/config";
import { ModHost } from "../src/main/mods/host";
import { registerModsIpc } from "../src/main/mods/mods-ipc";
import { resolveMods } from "../src/main/mods/resolve";
import { ModBuilds, UserLayer, userConsent, userModFolders, watchLayouts, watchUserLayer, writeMainShims } from "../src/main/mods/user-layer";

let tmp: string;
let home: string;
let buildRoot: string;
beforeEach(async () => {
  tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-user-layer-")));
  home = path.join(tmp, "app");
  buildRoot = path.join(tmp, "mod-build");
  await fs.mkdir(path.join(home, "mods"), { recursive: true });
});
afterEach(() => fs.rm(tmp, { recursive: true, force: true }));

const modDir = (folder: string) => path.join(home, "mods", folder);
async function writeMod(folder: string, files: Record<string, string>) {
  for (const [rel, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(modDir(folder), rel)), { recursive: true });
    await fs.writeFile(path.join(modDir(folder), rel), text);
  }
}
const modJson = (id: string, extra: Record<string, unknown> = {}) => JSON.stringify({ id, name: "Greet", version: "0.1.0", apiVersion: 1, main: "main.ts", ...extra });
/** A main that rewrites "hi" to `word`, through the mod-sdk and zod the app gives. */
const mainTs = (id: string, word: string) =>
  `import { defineMod } from "@humanharness/mod-sdk";\nimport { z } from "zod";\nexport default defineMod({ id: "${id}", main(ctx) { ctx.on.beforeSend((s) => (s.text === "hi" ? { kind: "rewrite", text: z.string().parse("${word}") } : { kind: "pass" })); } });\n`;
const exists = (p: string) => fs.access(p).then(() => true, () => false);

async function setup() {
  let saved: ModsSettings | undefined;
  const config = { load: async () => saved, save: async (m: ModsSettings | undefined) => void (saved = cleanModsConfig(m)) };
  const resolveShared = await writeMainShims(path.join(buildRoot, ".shared"), MAIN_SHARED_MODULES);
  const builds = new ModBuilds(buildRoot, resolveShared);
  const reloaded = vi.fn();
  const host = new ModHost({
    config: { load: config.load, saveFailed: async () => {} },
    services: () => ({}),
    notice: vi.fn(),
    changed: vi.fn(),
    builds,
    reloaded,
    hookMs: 5_000,
  });
  const resolved = await resolveMods({ declared: {}, harnessModsDir: "/nowhere", local: [], user: await userModFolders(home), core: {} });
  await host.start(resolved.mods);
  const layer = new UserLayer({ home, host, mods: resolved.mods, problems: resolved.problems, changed: vi.fn() });
  const consent = userConsent({ config, host, layer });
  const handlers = new Map<string, (...a: never[]) => unknown>();
  registerModsIpc(((c: string, fn: (...a: never[]) => unknown) => void handlers.set(c, fn)) as never, {
    view: async () => ({ mods: host.view(), problems: layer.problems() }),
    set: (id, on) => host.set(id, on),
    pickFolder: async () => null,
    addLocal: async () => {},
    removeLocal: async () => {},
    isLocal: () => false,
    taken: () => false,
    ...consent,
  });
  const call = (c: string, ...a: unknown[]) => (handlers.get(c) as (...x: unknown[]) => Promise<unknown>)(...a);
  const turnOn = async (id: string) => {
    const r = (await call("hh:modReviewLocal", id)) as { review: { id: string; folder: string }; token: string };
    await call("hh:modAddLocal", r.token);
  };
  return { host, layer, call, turnOn, reloaded, config };
}

describe("the user layer", () => {
  it("lists a folder in app/mods off; it turns on only through a review token, and is then trusted", async () => {
    await writeMod("greet", { "mod.json": modJson("greet"), "main.ts": mainTs("greet", "v1") });
    const { host, call, config } = await setup();
    expect(host.view()).toMatchObject([{ id: "greet", origin: "local", on: false }]);
    await expect(call("hh:modSet", "greet", true)).rejects.toThrow(/review/);
    expect(host.view()[0].on).toBe(false);
    const r = (await call("hh:modReviewLocal", "greet")) as { review: { id: string; folder: string }; token: string };
    expect(r.review).toMatchObject({ id: "greet", name: "Greet", folder: modDir("greet") });
    await call("hh:modAddLocal", r.token);
    expect(host.view()[0].on).toBe(true);
    expect((await config.load())?.trusted).toEqual(["greet"]);
    expect(await host.beforeSend({ text: "hi", task: null })).toBe("v1");
    // Trusted now: the switch works without another review.
    await call("hh:modSet", "greet", false);
    await call("hh:modSet", "greet", true);
    expect(host.view()[0].on).toBe(true);
    await expect(call("hh:modReviewLocal", "nope")).resolves.toMatchObject({ problem: expect.any(String) });
  });

  it("a new folder appears off", async () => {
    const { host, layer } = await setup();
    await writeMod("later", { "mod.json": modJson("later"), "main.ts": mainTs("later", "x") });
    await layer.sync(modDir("later"));
    expect(host.view()).toMatchObject([{ id: "later", on: false }]);
  });

  it("an edit to main.ts disposes the old hooks and registers the new ones", async () => {
    await writeMod("greet", { "mod.json": modJson("greet"), "main.ts": mainTs("greet", "v1") });
    const { host, layer, turnOn, reloaded } = await setup();
    await turnOn("greet");
    await writeMod("greet", { "main.ts": mainTs("greet", "v2") });
    await layer.sync(modDir("greet"));
    expect(await host.beforeSend({ text: "hi", task: null })).toBe("v2");
    expect(host.view()[0].registers.hooks).toEqual(["beforeSend"]);
    expect(reloaded).toHaveBeenCalledWith("greet", 1);
  });

  it("a broken edit keeps the old hooks and writes main.ts.error; fixing it deletes the .error", async () => {
    await writeMod("greet", { "mod.json": modJson("greet"), "main.ts": mainTs("greet", "v1") });
    const { host, layer, turnOn } = await setup();
    await turnOn("greet");
    await writeMod("greet", { "main.ts": "export default {\n  id: 'greet',,\n};\n" });
    await layer.sync(modDir("greet"));
    expect(await host.beforeSend({ text: "hi", task: null })).toBe("v1");
    expect(await fs.readFile(path.join(modDir("greet"), "main.ts.error"), "utf8")).toMatch(/main\.ts:2:/);
    expect(host.view()[0]).toMatchObject({ on: true, problem: expect.stringContaining("last good") });
    await writeMod("greet", { "main.ts": mainTs("greet", "v3") });
    await layer.sync(modDir("greet"));
    expect(await host.beforeSend({ text: "hi", task: null })).toBe("v3");
    expect(await exists(path.join(modDir("greet"), "main.ts.error"))).toBe(false);
    expect(host.view()[0].problem).toBeUndefined();
  });

  it("a main that throws or exports another id is broken too: the last good version runs", async () => {
    await writeMod("greet", { "mod.json": modJson("greet"), "main.ts": mainTs("greet", "v1") });
    const { host, layer, turnOn } = await setup();
    await turnOn("greet");
    await writeMod("greet", { "main.ts": mainTs("other", "v2") });
    await layer.sync(modDir("greet"));
    expect(await host.beforeSend({ text: "hi", task: null })).toBe("v1");
    expect(await fs.readFile(path.join(modDir("greet"), "main.ts.error"), "utf8")).toMatch(/greet/);
    await writeMod("greet", { "main.ts": "export default { id: 'greet', main() { throw new Error('boom'); } };\n" });
    await layer.sync(modDir("greet"));
    expect(await host.beforeSend({ text: "hi", task: null })).toBe("v1");
    expect(await fs.readFile(path.join(modDir("greet"), "main.ts.error"), "utf8")).toMatch(/boom/);
  });

  it("a broken mod.json writes mod.json.error and keeps the running version", async () => {
    await writeMod("greet", { "mod.json": modJson("greet"), "main.ts": mainTs("greet", "v1") });
    const { host, layer, turnOn } = await setup();
    await turnOn("greet");
    await writeMod("greet", { "mod.json": "{ nope" });
    await layer.sync(modDir("greet"));
    expect(await exists(path.join(modDir("greet"), "mod.json.error"))).toBe(true);
    expect(await host.beforeSend({ text: "hi", task: null })).toBe("v1");
    await writeMod("greet", { "mod.json": modJson("greet") });
    await layer.sync(modDir("greet"));
    expect(await exists(path.join(modDir("greet"), "mod.json.error"))).toBe(false);
  });

  it("a deleted folder turns the mod off and drops it", async () => {
    await writeMod("greet", { "mod.json": modJson("greet"), "main.ts": mainTs("greet", "v1") });
    const { host, layer, turnOn } = await setup();
    await turnOn("greet");
    await fs.rm(modDir("greet"), { recursive: true });
    await layer.sync(modDir("greet"));
    expect(host.view()).toEqual([]);
    expect(await host.beforeSend({ text: "hi", task: null })).toBe("hi");
  });

  it("a folder whose id is already taken is a problem, not a mod", async () => {
    await writeMod("greet", { "mod.json": modJson("greet"), "main.ts": mainTs("greet", "v1") });
    const { host, layer } = await setup();
    await writeMod("greet-copy", { "mod.json": modJson("greet"), "main.ts": mainTs("greet", "v1") });
    await layer.sync(modDir("greet-copy"));
    expect(host.view()).toHaveLength(1);
    expect(layer.problems()).toEqual([{ id: modDir("greet-copy"), reason: expect.stringContaining("already") }]);
  });

  it("the build goes to mod-build/<id>, with a last-good copy", async () => {
    await writeMod("greet", { "mod.json": modJson("greet", { ui: "ui.tsx" }), "main.ts": mainTs("greet", "v1"), "ui.tsx": "export const Panel = () => <b>hi</b>;\n" });
    const { turnOn } = await setup();
    await turnOn("greet");
    for (const f of ["main.mjs", "ui.js", "last-good/main.mjs", "last-good/ui.js"]) expect(await exists(path.join(buildRoot, "greet", f))).toBe(true);
  });
});

describe("watchUserLayer", () => {
  it("calls back once per mod folder for a burst of changes, and never for a .error file", async () => {
    await writeMod("greet", { "mod.json": modJson("greet") });
    const seen: string[] = [];
    const w = watchUserLayer(home, (dir) => void seen.push(dir), 100);
    try {
      // macOS may still report the files written before the watch started: let those pass first.
      await new Promise((r) => setTimeout(r, 600));
      seen.length = 0;
      await writeMod("greet", { "main.ts": "a", "lib/x.ts": "b" });
      await writeMod("greet", { "main.ts": "c" });
      await vi.waitFor(() => expect(seen).toEqual([modDir("greet")]), { timeout: 3_000 });
      await new Promise((r) => setTimeout(r, 300));
      expect(seen).toEqual([modDir("greet")]);
      await writeMod("greet", { "main.ts.error": "x" });
      await new Promise((r) => setTimeout(r, 400));
      expect(seen).toEqual([modDir("greet")]);
    } finally {
      w.close();
    }
  });
});

describe("watchLayouts", () => {
  it("calls back once for a burst under layouts/ or to settings.json, never for a .error file", async () => {
    let calls = 0;
    const w = watchLayouts(home, () => void (calls += 1), 100);
    try {
      await new Promise((r) => setTimeout(r, 600));
      calls = 0;
      await fs.writeFile(path.join(home, "layouts", "mine.json"), "{}");
      await fs.writeFile(path.join(home, "layouts", "mine.json"), "{ }");
      await vi.waitFor(() => expect(calls).toBe(1), { timeout: 3_000 });
      await new Promise((r) => setTimeout(r, 300));
      expect(calls).toBe(1);
      await fs.writeFile(path.join(home, "layouts", "mine.json.error"), "x");
      await new Promise((r) => setTimeout(r, 400));
      expect(calls).toBe(1);
      await fs.writeFile(path.join(home, "settings.json"), "{}");
      await vi.waitFor(() => expect(calls).toBe(2), { timeout: 3_000 });
      await fs.writeFile(path.join(home, "notes.md"), "x");
      await new Promise((r) => setTimeout(r, 400));
      expect(calls).toBe(2);
    } finally {
      w.close();
    }
  });
});
