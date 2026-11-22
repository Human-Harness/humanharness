import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ModStoreRegistry, appHome, buildServices, modHistoryIgnores } from "../../src/main/mods/services";

describe("mod services", () => {
  it("storage is a JSON file per mod in the app home, outside the work folder", async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), "hh-mods-"));
    const s = buildServices(fakeDeps({ userData }))("echo");
    expect(await s.storage!.get("k")).toBeUndefined();
    await s.storage!.set("k", { a: 1 });
    expect(await s.storage!.get("k")).toEqual({ a: 1 });
    expect(JSON.parse(await readFile(path.join(appHome(userData, "demo"), "storage", "echo.json"), "utf8"))).toEqual({ k: { a: 1 } });
  });
  it("storage writes one after another, so none is lost", async () => {
    const userData = await mkdtemp(path.join(os.tmpdir(), "hh-mods-"));
    const s = buildServices(fakeDeps({ userData }))("echo");
    await Promise.all([s.storage!.set("a", 1), s.storage!.set("b", 2), s.storage!.set("c", 3)]);
    expect([await s.storage!.get("a"), await s.storage!.get("b"), await s.storage!.get("c")]).toEqual([1, 2, 3]);
  });
  it("dataDir is created only when asked (D0), under .harness/mods/<id>", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "hh-base-"));
    const s = buildServices(fakeDeps({ base }))("echo");
    await expect(stat(path.join(base, ".harness", "mods", "echo"))).rejects.toThrow();
    expect(await s.dataDir!()).toBe(path.join(base, ".harness", "mods", "echo"));
    expect((await stat(path.join(base, ".harness", "mods", "echo"))).isDirectory()).toBe(true);
  });
  it("dataDir is null before setup", async () => {
    expect(await buildServices(fakeDeps({ base: null }))("echo").dataDir!()).toBeNull();
  });
  it("engine.run tags usage with the mod id and returns the text", async () => {
    const deps = fakeDeps({});
    const r = await buildServices(deps)("echo").engine!.run("light", "hi");
    expect(r).toEqual({ ok: true, text: "answer to hi" });
    expect(deps.engineRun).toHaveBeenCalledWith(expect.objectContaining({ process: "mod:echo", tier: "light", prompt: "hi" }));
  });
  it("history ignores a mod's data folder unless mod.json says history: true", () => {
    expect(modHistoryIgnores([{ id: "echo", history: false }, { id: "kept", history: true }])).toEqual([".harness/mods/echo/"]);
  });
  it("only a core mod's stores reach the shared registry: a user mod named like a harness collection takes none of its requests", () => {
    const stores = new ModStoreRegistry();
    const services = buildServices({ ...fakeDeps({}), stores, sharedStores: (id: string) => id === "sidekick" });
    services("recipes").stores!.open("recipes", COLLECTION);
    services("sidekick").stores!.open("sidekick", COLLECTION);
    expect(stores.has("recipes")).toBe(false);
    expect(stores.has("sidekick")).toBe(true);
  });
  it("a user mod's store takes its new collection when its ctx is built again (a reload)", async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), "hh-base-"));
    const services = buildServices({ ...fakeDeps({ base }), stores: new ModStoreRegistry(), sharedStores: () => false, data: { blocked: () => null, commit: async () => {} } });
    services("echo").stores!.open("echo", COLLECTION);
    const wider = { ...COLLECTION, schema: z.object({ id: z.string(), n: z.number() }) };
    const store = services("echo").stores!.open("echo", wider);
    await store.write([{ op: "put", collection: "echo", record: { id: "a", n: 1 } }]);
    expect(await store.readAll()).toEqual([{ id: "a", n: 1 }]);
  });
});

const COLLECTION = { scoped: false, key: "id", schema: z.object({ id: z.string(), text: z.string().optional() }), agent: "none" };

function fakeDeps(o: { userData?: string; base?: string | null }) {
  return {
    harnessId: "demo",
    userData: o.userData ?? os.tmpdir(),
    base: async () => (o.base === undefined ? os.tmpdir() : o.base),
    engineRun: vi.fn(async (r: { prompt: string }) => ({ ok: true, text: `answer to ${r.prompt}` })),
    runningTask: async () => null,
    noteTitles: async () => [],
    notify: vi.fn(),
  };
}
