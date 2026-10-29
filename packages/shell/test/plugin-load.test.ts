import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promises as fsp } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { PluginPointers, distFolderOf, loadPlugins, readDist } from "../src/main/plugin-load";

/** Writes a plugin folder `<root>/<name>/dist/` with plugin.json (from `over`) and backend.js. */
async function writePlugin(root: string, name: string, over: Record<string, unknown> = {}, files: Record<string, string> = {}) {
  const dist = path.join(root, name, "dist");
  await fs.mkdir(dist, { recursive: true });
  const manifest = { id: name, name: name, version: "1.0.0", api: 1, harness: "*", permissions: {}, sources: [{ id: "s", ttl: 60 }], ...over };
  await fs.writeFile(path.join(dist, "plugin.json"), JSON.stringify(manifest));
  await fs.writeFile(path.join(dist, "backend.js"), "export default { sources: { s: async () => {} } };\n");
  for (const [f, text] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(dist, f)), { recursive: true });
    await fs.writeFile(path.join(dist, f), text);
  }
  return dist;
}
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "hh-pl-load-"));
const hashOf = (r: unknown) => (r as { distHash: string }).distHash;

describe("readDist (plugins spec §3.1, §7 Add from folder step 1)", () => {
  it("reads plugin.json and hashes dist", async () => {
    const dist = await writePlugin(await tmp(), "oncall");
    const r = await readDist(dist, "dev");
    expect(r).toMatchObject({ ok: true, manifest: { id: "oncall" } });
    expect(hashOf(r)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("gives the sha256 of the backend.js bytes it hashed (the backend host runs only those)", async () => {
    const dist = await writePlugin(await tmp(), "oncall");
    const r = await readDist(dist, "dev");
    const bytes = await fs.readFile(path.join(dist, "backend.js"));
    expect((r as { backendHash: string }).backendHash).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("a code change changes the hash; the same files give the same hash", async () => {
    const dist = await writePlugin(await tmp(), "a", {}, { "ui/panel.js": "x" });
    const one = await readDist(dist, "dev");
    expect(hashOf(await readDist(dist, "dev"))).toBe(hashOf(one));
    await fs.writeFile(path.join(dist, "backend.js"), "export default { sources: { s: async () => { } } };\n");
    const two = await readDist(dist, "dev");
    expect(hashOf(two)).not.toBe(hashOf(one));
    await fs.rename(path.join(dist, "ui", "panel.js"), path.join(dist, "ui", "panel2.js"));
    expect(hashOf(await readDist(dist, "dev"))).not.toBe(hashOf(two));
  });

  it.each([
    ["api", { api: 2 }, /api 2; this app has 1/],
    ["api (with fields this app doesn't know)", { api: 2, future: true }, /api 2/],
    ["harness", { harness: "other" }, /harness "other"/],
    ["schema", { id: "Bad" }, /^id: /],
  ])("refuses a wrong %s", async (_n, over, why) => {
    const dist = await writePlugin(await tmp(), "a", over);
    expect(await readDist(dist, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(why) });
  });

  it("accepts a plugin for this very harness", async () => {
    const dist = await writePlugin(await tmp(), "a", { harness: "dev" });
    expect(await readDist(dist, "dev")).toMatchObject({ ok: true });
  });

  it("errors from the collection and settings models are load errors (carry note: call both in a try)", async () => {
    const root = await tmp();
    const optionalKey = { key: "k", agent: "none", schema: { type: "object", properties: { k: { type: "string" } } } };
    const d1 = await writePlugin(root, "a", { data: { q: optionalKey } });
    expect(await readDist(d1, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/^data: .*key/) });
    const d2 = await writePlugin(root, "b", { settings: { fields: { on: { schema: { type: "boolean" }, default: false, control: "slider", label: "On" } } } });
    expect(await readDist(d2, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/^settings: /) });
  });

  it("B12: an action prompt with hidden characters is refused (the card would not show what the agent reads)", async () => {
    const root = await tmp();
    for (const [i, x] of ["\u{e0041}", "\u202e", "\u200b"].entries()) {
      const action = { id: "a", label: "A", tier: "light", prompt: `Explain.${x}` };
      const dist = await writePlugin(root, `p${i}`, { permissions: { tasks: true }, actions: [action] });
      expect(await readDist(dist, "dev"), JSON.stringify(x)).toMatchObject({ ok: false, error: expect.stringMatching(/hidden or control/) });
    }
  });

  it("refuses a plugin.json over 256 KB, invalid JSON, a non-object, and a missing backend.js", async () => {
    const root = await tmp();
    const dist = await writePlugin(root, "a");
    await fs.writeFile(path.join(dist, "plugin.json"), "x".repeat(256 * 1024 + 1));
    expect(await readDist(dist, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/256 KB/) });
    await fs.writeFile(path.join(dist, "plugin.json"), "{");
    expect(await readDist(dist, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) });
    await fs.writeFile(path.join(dist, "plugin.json"), "[1]");
    expect(await readDist(dist, "dev")).toMatchObject({ ok: false });
    const dist2 = await writePlugin(root, "b");
    await fs.rm(path.join(dist2, "backend.js"));
    expect(await readDist(dist2, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/backend\.js/) });
    await fs.rm(path.join(dist2, "plugin.json"));
    expect(await readDist(dist2, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/plugin\.json/) });
  });

  it("refuses a backend.js over 5 MB without reading it", async () => {
    const dist = await writePlugin(await tmp(), "a");
    await fs.truncate(path.join(dist, "backend.js"), 5 * 1024 * 1024 + 1);
    expect(await readDist(dist, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/backend\.js.*5 MB/) });
  });

  it("refuses plugin.json or backend.js that is a folder", async () => {
    const root = await tmp();
    const dist = await writePlugin(root, "a");
    await fs.rm(path.join(dist, "backend.js"));
    await fs.mkdir(path.join(dist, "backend.js"));
    expect(await readDist(dist, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/backend\.js/) });
    const dist2 = await writePlugin(root, "b");
    await fs.rm(path.join(dist2, "plugin.json"));
    await fs.mkdir(path.join(dist2, "plugin.json"));
    expect(await readDist(dist2, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/plugin\.json/) });
  });

  it("B3: a symlink that leaves dist makes the plugin unloadable", async () => {
    const root = await tmp();
    const dist = await writePlugin(root, "a");
    await fs.writeFile(path.join(root, "secret.txt"), "nope");
    await fs.symlink(path.join(root, "secret.txt"), path.join(dist, "data.json"));
    expect(await readDist(dist, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/outside/) });
  });

  it("B3: plugin.json itself linked outside dist is refused before it is read", async () => {
    const root = await tmp();
    const dist = await writePlugin(root, "a");
    await fs.rename(path.join(dist, "plugin.json"), path.join(root, "real.json"));
    await fs.symlink(path.join(root, "real.json"), path.join(dist, "plugin.json"));
    expect(await readDist(dist, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/plugin\.json points outside/) });
  });

  it("B3: a relative ../ symlink, a symlinked folder outside, a dangling link and a link loop are refused", async () => {
    const root = await tmp();
    const d1 = await writePlugin(root, "a");
    await fs.writeFile(path.join(root, "a", "x.txt"), "out");
    await fs.symlink("../x.txt", path.join(d1, "x.txt"));
    expect(await readDist(d1, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/outside/) });
    const d2 = await writePlugin(root, "b");
    await fs.symlink(os.tmpdir(), path.join(d2, "tmpdir"));
    expect(await readDist(d2, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/outside/) });
    const d3 = await writePlugin(root, "c");
    await fs.symlink(path.join(d3, "nothing"), path.join(d3, "gone.js"));
    expect(await readDist(d3, "dev")).toMatchObject({ ok: false });
    const d4 = await writePlugin(root, "d");
    await fs.symlink(path.join(d4, "loop2"), path.join(d4, "loop1"));
    await fs.symlink(path.join(d4, "loop1"), path.join(d4, "loop2"));
    expect(await readDist(d4, "dev")).toMatchObject({ ok: false });
  });

  it("a symlink that stays inside dist is fine; a linked folder inside is not walked twice", async () => {
    const root = await tmp();
    const dist = await writePlugin(root, "a", {}, { "ui/a.js": "a" });
    await fs.symlink(path.join(dist, "ui", "a.js"), path.join(dist, "alias.js"));
    await fs.symlink("..", path.join(dist, "ui", "up"));
    expect(await readDist(dist, "dev")).toMatchObject({ ok: true });
  });

  it("a dist reached through a link is read from its real folder", async () => {
    const root = await tmp();
    const dist = await writePlugin(root, "a");
    await fs.symlink(dist, path.join(root, "link"));
    expect(await readDist(path.join(root, "link"), "dev")).toMatchObject({ ok: true });
  });

  it("B3: a hard link to a file outside dist is refused, walked directly or through a symlink", async () => {
    const root = await tmp();
    const d1 = await writePlugin(root, "a");
    await fs.writeFile(path.join(root, "secret.txt"), "nope");
    await fs.link(path.join(root, "secret.txt"), path.join(d1, "data.json"));
    expect(await readDist(d1, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/data\.json.*hard links are not allowed/) });
    const d2 = await writePlugin(root, "b");
    await fs.writeFile(path.join(root, "secret2.txt"), "nope");
    await fs.mkdir(path.join(d2, "x"));
    await fs.link(path.join(root, "secret2.txt"), path.join(d2, "x", "h.txt"));
    await fs.symlink(path.join(d2, "x", "h.txt"), path.join(d2, "alias.txt"));
    expect(await readDist(d2, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/hard links are not allowed/) });
  });

  it("B3: a folder swapped for a link to outside after the walk is refused before it is hashed", async () => {
    const root = await tmp();
    const dist = await writePlugin(root, "a", {}, { "ui/panel.js": "inside" });
    await fs.mkdir(path.join(root, "evil"));
    await fs.writeFile(path.join(root, "evil", "panel.js"), "INSIDE"); // Same size: only the path check can catch it.
    const open = fsp.open.bind(fsp);
    // The first file opened is plugin.json, after the walk: swap ui/ for a link out right then.
    const spy = vi.spyOn(fsp, "open").mockImplementationOnce(async (...args: Parameters<typeof fsp.open>) => {
      await fs.rename(path.join(dist, "ui"), path.join(root, "ui-old"));
      await fs.symlink(path.join(root, "evil"), path.join(dist, "ui"));
      return open(...args);
    });
    try {
      expect(await readDist(dist, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/ui\/panel\.js.*outside/) });
    } finally {
      spy.mockRestore();
    }
  });

  it("refuses special files (a named pipe) without opening them", async () => {
    const dist = await writePlugin(await tmp(), "a");
    execFileSync("mkfifo", [path.join(dist, "pipe")]);
    expect(await readDist(dist, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/pipe.*not a regular file/) });
  });

  it("refuses a dist over 500 entries or over 50 MB, without hashing it", async () => {
    const root = await tmp();
    const many = Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`f/${i}.txt`, ""]));
    const d1 = await writePlugin(root, "a", {}, many);
    expect(await readDist(d1, "dev")).toMatchObject({ ok: false, error: "dist is too large" });
    const d2 = await writePlugin(root, "b");
    await fs.writeFile(path.join(d2, "big.bin"), "");
    await fs.truncate(path.join(d2, "big.bin"), 50 * 1024 * 1024 + 1);
    expect(await readDist(d2, "dev")).toMatchObject({ ok: false, error: "dist is too large" });
  });

  it("refuses a folder nested too deep", async () => {
    const root = await tmp();
    const dist = await writePlugin(root, "a");
    await fs.mkdir(path.join(dist, ...Array.from({ length: 40 }, () => "d")), { recursive: true });
    expect(await readDist(dist, "dev")).toMatchObject({ ok: false, error: expect.stringMatching(/deep/) });
  });

  it("odd file names (newline, unicode, spaces) hash without error", async () => {
    const dist = await writePlugin(await tmp(), "a", {}, { "a\nb.txt": "1", "ñ é.txt": "2", ".hidden": "3" });
    expect(await readDist(dist, "dev")).toMatchObject({ ok: true });
  });

  it("a missing dist or a file instead of a folder is an error, not a throw", async () => {
    const root = await tmp();
    expect(await readDist(path.join(root, "nope"), "dev")).toMatchObject({ ok: false });
    await fs.writeFile(path.join(root, "file"), "x");
    expect(await readDist(path.join(root, "file"), "dev")).toMatchObject({ ok: false });
  });

  it("never runs plugin code: a backend that would throw at import still loads", async () => {
    const dist = await writePlugin(await tmp(), "a");
    await fs.writeFile(path.join(dist, "backend.js"), "throw new Error('ran');\n");
    expect(await readDist(dist, "dev")).toMatchObject({ ok: true });
  });
});

describe("distFolderOf (Decision 18)", () => {
  it("takes a plugin folder or its dist", async () => {
    const root = await tmp();
    const dist = await writePlugin(root, "a");
    expect(await distFolderOf(path.join(root, "a"))).toBe(dist);
    expect(await distFolderOf(dist)).toBe(dist);
    expect(await distFolderOf(root)).toBeNull();
    expect(await distFolderOf(path.join(root, "missing"))).toBeNull();
  });
});

describe("PluginPointers (§3.3, B13)", () => {
  it("writes nothing until a plugin is added; adds, lists, removes", async () => {
    const shared = await tmp();
    const p = new PluginPointers(path.join(shared, "dev", "plugins.json"));
    expect(await p.list()).toEqual([]);
    await expect(fs.access(path.join(shared, "dev"))).rejects.toThrow();
    await p.add("oncall", "/Users/x/my-plugins/oncall");
    expect(await p.list()).toEqual([{ id: "oncall", folder: "/Users/x/my-plugins/oncall" }]);
    await p.add("oncall", "/Users/x/other");
    expect(await p.list()).toEqual([{ id: "oncall", folder: "/Users/x/other" }]);
    await p.remove("oncall");
    expect(await p.list()).toEqual([]);
  });

  it("refuses a bad id or a relative folder", async () => {
    const p = new PluginPointers(path.join(await tmp(), "plugins.json"));
    await expect(p.add("../x", "/x")).rejects.toThrow();
    await expect(p.add("__proto__", "/x")).rejects.toThrow();
    await expect(p.add("a", "rel/x")).rejects.toThrow();
  });

  it("drops entries a hand edit broke: bad ids, relative folders, duplicates, non-objects", async () => {
    const file = path.join(await tmp(), "plugins.json");
    await fs.writeFile(file, JSON.stringify([{ id: "a", folder: "/a" }, { id: "__proto__", folder: "/b" }, { id: "c", folder: "c" }, { id: "a", folder: "/z" }, 7, null]));
    expect(await new PluginPointers(file).list()).toEqual([{ id: "a", folder: "/a" }]);
    await fs.writeFile(file, JSON.stringify({ a: "/a" }));
    expect(await new PluginPointers(file).list()).toEqual([]);
  });

  it("a broken pointers file reads as empty and is set aside on the next write", async () => {
    const shared = await tmp();
    const file = path.join(shared, "dev", "plugins.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{");
    const p = new PluginPointers(file);
    expect(await p.list()).toEqual([]);
    expect(await fs.readFile(file, "utf8")).toBe("{");
    await p.add("a", "/x");
    expect((await fs.readdir(path.dirname(file))).some((f) => f.startsWith("plugins.json.corrupt-"))).toBe(true);
    expect(await p.list()).toEqual([{ id: "a", folder: "/x" }]);
  });

  it("a pointers file over 1 MB reads as empty and is set aside on the next write", async () => {
    const file = path.join(await tmp(), "plugins.json");
    await fs.writeFile(file, JSON.stringify([{ id: "a", folder: "/a" }]));
    await fs.appendFile(file, " ".repeat(1024 * 1024));
    const p = new PluginPointers(file);
    expect(await p.list()).toEqual([]);
    await p.add("b", "/b");
    expect((await fs.readdir(path.dirname(file))).some((f) => f.startsWith("plugins.json.corrupt-"))).toBe(true);
    expect(await p.list()).toEqual([{ id: "b", folder: "/b" }]);
  });
});

describe("loadPlugins", () => {
  it("bundled from <harness>/plugins/<id>/dist, local from pointers, dev from HH_PLUGIN_DIRS; dev > bundled > local on a clash", async () => {
    const root = await tmp();
    await writePlugin(path.join(root, "plugins"), "oncall");
    const local = await tmp();
    await writePlugin(local, "mine");
    await writePlugin(local, "oncall");
    const shared = await tmp();
    const pointers = new PluginPointers(path.join(shared, "dev", "plugins.json"));
    await pointers.add("mine", path.join(local, "mine"));
    await pointers.add("oncall", path.join(local, "oncall"));
    const list = await loadPlugins({ harness: { id: "dev", root, plugins: { bundled: ["oncall"], on: [], local: true } }, pointers, devDirs: [] });
    expect(list.map((e) => [e.id, e.origin])).toEqual([["oncall", "bundled"], ["mine", "local"]]);
    expect(list[1]).toMatchObject({ folder: path.join(local, "mine"), dist: await fs.realpath(path.join(local, "mine", "dist")), distHash: expect.any(String) });

    const devRoot = await tmp();
    await writePlugin(devRoot, "oncall");
    const withDev = await loadPlugins({ harness: { id: "dev", root, plugins: { bundled: ["oncall"], on: [], local: true } }, pointers, devDirs: [path.join(devRoot, "oncall")] });
    expect(withDev.map((e) => [e.id, e.origin])).toEqual([["oncall", "dev"], ["mine", "local"]]);
  });

  it("D0: a harness without plugins and no dev dirs loads nothing and reads no pointers file", async () => {
    let read = false;
    const pointers = { list: async () => ((read = true), []) } as unknown as PluginPointers;
    expect(await loadPlugins({ harness: { id: "dev", root: "/nope" }, pointers, devDirs: [] })).toEqual([]);
    expect(await loadPlugins({ harness: { id: "dev", root: "/nope", plugins: { bundled: [], on: [], local: false } }, pointers, devDirs: [] })).toEqual([]);
    expect(read).toBe(false);
  });

  it("dev dirs load even in a harness without plugins, and never read the pointers", async () => {
    let read = false;
    const pointers = { list: async () => ((read = true), []) } as unknown as PluginPointers;
    const devRoot = await tmp();
    await writePlugin(devRoot, "probe");
    const list = await loadPlugins({ harness: { id: "dev", root: "/nope" }, pointers, devDirs: [path.join(devRoot, "probe")] });
    expect(list.map((e) => [e.id, e.origin, e.error])).toEqual([["probe", "dev", undefined]]);
    expect(read).toBe(false);
  });

  it("local plugins are ignored when the harness says local: false", async () => {
    const local = await tmp();
    await writePlugin(local, "mine");
    const pointers = new PluginPointers(path.join(await tmp(), "plugins.json"));
    await pointers.add("mine", path.join(local, "mine"));
    expect(await loadPlugins({ harness: { id: "dev", root: "/nope", plugins: { bundled: [], on: [], local: false } }, pointers, devDirs: [] })).toEqual([]);
  });

  it("a bundled folder whose plugin.json id differs is an error entry", async () => {
    const root = await tmp();
    await writePlugin(path.join(root, "plugins"), "oncall", { id: "other" });
    const [e] = await loadPlugins({ harness: { id: "dev", root, plugins: { bundled: ["oncall"], on: [], local: false } }, pointers: new PluginPointers(path.join(root, "p.json")), devDirs: [] });
    expect(e).toMatchObject({ id: "oncall", origin: "bundled", manifest: null, error: expect.stringMatching(/id/) });
  });

  it("a local pointer to a missing folder, a mismatched id, or a broken plugin is an error entry, not a throw", async () => {
    const local = await tmp();
    await writePlugin(local, "mine", { id: "other" });
    await writePlugin(local, "broken", { api: 9 });
    const pointers = new PluginPointers(path.join(await tmp(), "plugins.json"));
    await pointers.add("gone", path.join(local, "gone"));
    await pointers.add("mine", path.join(local, "mine"));
    await pointers.add("broken", path.join(local, "broken"));
    const list = await loadPlugins({ harness: { id: "dev", root: "/nope", plugins: { bundled: [], on: [], local: true } }, pointers, devDirs: [] });
    expect(list.map((e) => [e.id, e.origin, e.manifest])).toEqual([["gone", "local", null], ["mine", "local", null], ["broken", "local", null]]);
    expect(list.every((e) => typeof e.error === "string")).toBe(true);
    expect(list[0].folder).toBe(path.join(local, "gone"));
  });

  it("a pointers file that can't be read (not a missing one) loses the local plugins, not the load", async () => {
    const root = await tmp();
    await writePlugin(path.join(root, "plugins"), "oncall");
    const file = path.join(root, "plugins.json");
    await fs.mkdir(file);
    const list = await loadPlugins({ harness: { id: "dev", root, plugins: { bundled: ["oncall"], on: [], local: true } }, pointers: new PluginPointers(file), devDirs: [] });
    expect(list.map((e) => [e.id, e.origin])).toEqual([["oncall", "bundled"]]);
  });

  it("a broken dev folder shows under its folder name only when that is a valid id", async () => {
    const devRoot = await tmp();
    await fs.mkdir(path.join(devRoot, "Bad Name"));
    await fs.mkdir(path.join(devRoot, "okname"));
    const list = await loadPlugins({ harness: { id: "dev", root: "/nope" }, pointers: new PluginPointers(path.join(devRoot, "p.json")), devDirs: [path.join(devRoot, "Bad Name"), path.join(devRoot, "okname")] });
    expect(list.map((e) => [e.id, e.origin, e.manifest])).toEqual([["okname", "dev", null]]);
  });
});
