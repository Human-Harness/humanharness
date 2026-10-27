import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_SIDEKICK, SIDEKICK_COLLECTION, type SidekickRecord, sidekickCollection } from "@humanharness/harness-sdk";
import { APP_SCOPE, DataStore, runDataRequest } from "@humanharness/workspace";
import { SidekickStore } from "../src/main/sidekick-store";

async function store(manifest?: { default: "on" | "off" }) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "hh-sks-"));
  const ds = new DataStore(base, { [SIDEKICK_COLLECTION]: sidekickCollection() });
  const writes: unknown[] = [];
  const s = new SidekickStore({
    readAll: async () => (await ds.readAll(SIDEKICK_COLLECTION, APP_SCOPE)).records as never,
    write: async (request) => {
      writes.push(request);
      return runDataRequest(ds, request, { who: "person", scope: APP_SCOPE });
    },
    ...(manifest ? { manifest } : {}),
  });
  return { s, ds, writes, base };
}

describe("SidekickStore", () => {
  it("defaults without a record; the manifest's default decides on", async () => {
    expect((await (await store()).s.settings()).on).toBe(false);
    expect((await (await store({ default: "on" })).s.settings()).on).toBe(true);
  });

  it("stores only values that differ from the defaults", async () => {
    const { s, ds } = await store();
    await s.set({ on: true, wait: 10 });
    expect(await ds.get(SIDEKICK_COLLECTION, "settings", { who: "person", scope: APP_SCOPE })).toEqual({ id: "settings", type: "settings", on: true, wait: 10 });
    expect(await s.settings()).toMatchObject({ on: true, wait: 10, cap: 20_000 });
  });

  it("back to every default deletes the record", async () => {
    const { s, ds, writes } = await store();
    await s.set({ on: true });
    await s.set({ on: false });
    expect(writes.at(-1)).toMatchObject({ op: "delete", collection: "sidekick" });
    expect(await ds.get(SIDEKICK_COLLECTION, "settings", { who: "person", scope: APP_SCOPE })).toBeNull();
  });

  it("refuses bad values as data", async () => {
    const { s, writes } = await store();
    expect(await s.set({ wait: 7 } as never)).toMatchObject({ ok: false });
    expect(await s.set({ nope: 1 } as never)).toMatchObject({ ok: false });
    expect(writes).toEqual([]);
  });

  it("a write failure comes back as data", async () => {
    const s = new SidekickStore({ readAll: async () => [], write: async () => Promise.reject(new Error("The app is closing")) });
    expect(await s.set({ on: true })).toEqual({ ok: false, message: "The app is closing" });
  });

  it("two quick changes both survive", async () => {
    const { s } = await store();
    await Promise.all([s.set({ wait: 10 }), s.set({ cap: 50_000 })]);
    expect(await s.settings()).toMatchObject({ wait: 10, cap: 50_000 });
  });

  it("a change to the same value writes nothing", async () => {
    const { s, writes } = await store();
    await s.set({ on: true });
    await s.set({ on: true });
    expect(writes).toHaveLength(1);
  });

  it("a failed read writes nothing", async () => {
    const writes: unknown[] = [];
    const s = new SidekickStore({ readAll: async () => Promise.reject(new Error("disk")), write: async (r) => writes.push(r) });
    expect(await s.set({ on: true })).toEqual({ ok: false, message: "disk" });
    expect(writes).toEqual([]);
  });

  it("part 2 settings: the moments, presetsOffered and muted can be set; muted {} counts as the default", async () => {
    const { s, ds } = await store();
    expect(await s.set({ afterReply: false, headsUps: false, presetsOffered: true, muted: { sidekick: ["vague"] } })).toMatchObject({ ok: true });
    expect(await s.settings()).toMatchObject({ afterReply: false, headsUps: false, presetsOffered: true, muted: { sidekick: ["vague"] } });
    await s.set({ afterReply: true, headsUps: true, presetsOffered: false, muted: {} });
    expect(await ds.get(SIDEKICK_COLLECTION, "settings", { who: "person", scope: APP_SCOPE })).toBeNull();
  });

  it("a toggle keeps learnedAt and lastDaily", async () => {
    const { s, ds } = await store();
    await s.set({ learnedAt: "2026-10-27T09:00:00.000Z", lastDaily: "2026-10-27" });
    await s.set({ on: true });
    await s.set({ wait: 10 });
    expect(await ds.get(SIDEKICK_COLLECTION, "settings", { who: "person", scope: APP_SCOPE })).toEqual({ id: "settings", type: "settings", on: true, wait: 10, learnedAt: "2026-10-27T09:00:00.000Z", lastDaily: "2026-10-27" });
    expect(await s.settings()).toMatchObject({ learnedAt: "2026-10-27T09:00:00.000Z", lastDaily: "2026-10-27" });
  });

  it("the other record types sit next to the settings: all, put, remove", async () => {
    const { s } = await store();
    await s.set({ on: true });
    await s.put({ id: "l-00000001", type: "learned", text: "Writes in short sentences.", level: "you", source: "learned", updatedAt: "2026-10-27T09:00:00Z" });
    expect((await s.all()).map((r) => r.id).sort()).toEqual(["l-00000001", "settings"]);
    expect((await s.settings()).on).toBe(true);
    await s.remove("l-00000001");
    expect((await s.all()).map((r) => r.id)).toEqual(["settings"]);
  });

  it("mute: per sidekick, once per kind, plus a learned item that is the person's; unmute drops it", async () => {
    const { s } = await store();
    await Promise.all([s.mute("sidekick", "Sidekick", "vague", "2026-10-27T09:00:00Z"), s.mute("sidekick", "Sidekick", "two-asks", "2026-10-27T09:00:00Z")]);
    await s.mute("sidekick", "Sidekick", "vague", "2026-10-27T09:00:00Z");
    expect((await s.settings()).muted).toEqual({ sidekick: ["vague", "two-asks"] });
    const learned = (await s.all()).filter((r) => r.type === "learned");
    expect(learned.map((r) => r.kind).sort()).toEqual(["two-asks", "vague"]);
    expect(learned.find((r) => r.kind === "vague")).toMatchObject({ id: expect.stringMatching(/^l-[0-9a-f]{8}$/), level: "you", source: "person", kind: "vague", text: "Doesn't want vague suggestions from Sidekick." });
    await s.unmute("sidekick", "vague");
    await s.unmute("__proto__", "vague");
    expect((await s.settings()).muted).toEqual({ sidekick: ["two-asks"] });
    await s.unmute("sidekick", "two-asks");
    expect((await s.settings()).muted).toEqual({});
  });

  it("muted again after an unmute: muted, with no second learned item; after Forget this, a new one", async () => {
    const { s } = await store();
    await s.mute("sidekick", "Sidekick", "vague", "2026-10-27T09:00:00Z");
    await s.unmute("sidekick", "vague");
    await s.mute("sidekick", "Sidekick", "vague", "2026-10-27T10:00:00Z");
    expect((await s.settings()).muted).toEqual({ sidekick: ["vague"] });
    const learned = (await s.all()).filter((r) => r.type === "learned");
    expect(learned).toHaveLength(1);
    await s.remove(learned[0].id);
    await s.unmute("sidekick", "vague");
    await s.mute("sidekick", "Sidekick", "vague", "2026-10-27T11:00:00Z");
    expect((await s.all()).filter((r) => r.type === "learned")).toHaveLength(1);
  });
});

/** An in-memory collection: `readAll` returns `records`, `write` mutates them (put replaces by id, delete removes). */
function mem(initial: object[]) {
  const records = initial.map((r) => ({ ...r })) as SidekickRecord[];
  const writes: unknown[] = [];
  const deleted: string[] = [];
  const s = new SidekickStore({
    readAll: async () => records.map((r) => ({ ...r })),
    write: async (request) => {
      writes.push(request);
      const r = request as { op: string; record?: SidekickRecord; key?: string };
      if (r.op === "put" && r.record) {
        const at = records.findIndex((x) => x.id === r.record!.id);
        if (at >= 0) records[at] = r.record;
        else records.push(r.record);
      } else if (r.op === "delete" && r.key) {
        deleted.push(r.key);
        const at = records.findIndex((x) => x.id === r.key);
        if (at >= 0) records.splice(at, 1);
      }
      return { ok: true };
    },
  });
  return { store: s, writes, deleted, records };
}

const RULO = { id: "rulo", type: "sidekick", name: "Rulo", mark: "x", personality: "", purposes: [{ id: "mentor" }], order: 1 };

describe("sidekick records (spec §2a.1, Decisions 1–2)", () => {
  it("D0: no sidekick records → the implicit default, nothing written", async () => {
    const s = mem([]);
    expect(await s.store.sidekicks()).toEqual([DEFAULT_SIDEKICK]);
    expect(await s.store.scopeFor("main", "sidekick")).toEqual({ on: true });
    expect(s.writes).toEqual([]);
  });

  it("D0: a part 1 profile (settings only) still has exactly the default Sidekick", async () => {
    const s = mem([{ id: "settings", type: "settings", on: true }]);
    expect(await s.store.sidekicks()).toEqual([DEFAULT_SIDEKICK]);
    expect((await s.store.settings()).on).toBe(true);
    expect(s.writes).toEqual([]);
  });

  it("saving a new one writes the default first, then the new one with a slug id and the next order", async () => {
    const s = mem([]);
    const saved = await s.store.saveSidekick({ name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }] });
    expect(saved.id).toBe("rulo");
    expect(s.writes.map((w) => (w as { record: { id: string } }).record.id)).toEqual(["sidekick", "rulo"]);
    expect((await s.store.sidekicks()).map((k) => [k.id, k.order])).toEqual([["sidekick", 0], ["rulo", 1]]);
  });

  it("editing keeps the id and the order; an unknown id is refused", async () => {
    const s = mem([{ ...DEFAULT_SIDEKICK, type: "sidekick" }, RULO]);
    const saved = await s.store.saveSidekick({ id: "rulo", name: "Rulo II", mark: "y", personality: "Calm.", purposes: [{ id: "focus" }], defaultOn: false });
    expect(saved).toEqual({ id: "rulo", name: "Rulo II", mark: "y", personality: "Calm.", purposes: [{ id: "focus" }], order: 1, defaultOn: false });
    await expect(s.store.saveSidekick({ id: "nope", name: "N", mark: "n", personality: "", purposes: [{ id: "focus" }] })).rejects.toThrow(/No sidekick/);
  });

  it("name clashes get -2, -3", async () => {
    const s = mem([{ ...DEFAULT_SIDEKICK, type: "sidekick" }]);
    expect((await s.store.saveSidekick({ name: "Sidekick", mark: "x", personality: "", purposes: [{ id: "mentor" }] })).id).toBe("sidekick-2");
    expect((await s.store.saveSidekick({ name: "Sidekick", mark: "x", personality: "", purposes: [{ id: "mentor" }] })).id).toBe("sidekick-3");
  });

  it("reserved ids: a new one is never `learn` (the learning folder) nor `sidekick` (the default's), even after it is gone", async () => {
    const s = mem([{ ...RULO, order: 0 }]);
    expect((await s.store.saveSidekick({ name: "Learn", mark: "x", personality: "", purposes: [{ id: "mentor" }] })).id).toBe("learn-2");
    expect((await s.store.saveSidekick({ name: "Sidekick", mark: "x", personality: "", purposes: [{ id: "mentor" }] })).id).toBe("sidekick-2");
    expect((await s.store.saveSidekick({ name: "!!!", mark: "x", personality: "", purposes: [{ id: "mentor" }] })).id).toBe("sidekick-3");
  });

  it("reserved ids: a new one is never `route` (the routing turn's folder)", async () => {
    const s = mem([{ ...RULO, order: 0 }]);
    expect((await s.store.saveSidekick({ name: "Route", mark: "x", personality: "", purposes: [{ id: "mentor" }] })).id).toBe("route-2");
  });

  it("a new id never takes another record's: settings, a scope record, a learned item's shape (s-, l-)", async () => {
    const s = mem([
      { ...DEFAULT_SIDEKICK, type: "sidekick" },
      { id: "settings", type: "settings", on: true },
      { id: "s-main-rulo", type: "scope", scope: "main", sidekick: "rulo", on: false },
      { id: "l-1a2b3c4d", type: "learned", text: "x", level: "you", source: "person", updatedAt: "2026-10-27T09:00:00Z" },
    ]);
    const add = async (name: string) => (await s.store.saveSidekick({ name, mark: "x", personality: "", purposes: [{ id: "mentor" }] })).id;
    expect(await add("Settings")).toBe("settings-2");
    expect(await add("S Main Rulo")).toBe("k-s-main-rulo");
    expect(await add("L 1a2b3c4d")).toBe("k-l-1a2b3c4d");
    expect(await add("L Other")).toBe("k-l-other");
    expect(s.records.find((r) => r.id === "settings")).toEqual({ id: "settings", type: "settings", on: true });
    expect(s.records.filter((r) => r.type !== "sidekick").map((r) => r.id)).toEqual(["settings", "s-main-rulo", "l-1a2b3c4d"]);
  });

  it("a slug drops accents rather than splitting on them", async () => {
    const s = mem([]);
    expect((await s.store.saveSidekick({ name: "Andrés", mark: "x", personality: "", purposes: [{ id: "mentor" }] })).id).toBe("andres");
  });

  it("muting an unknown sidekick writes nothing; a new sidekick never inherits a stale muted entry", async () => {
    const s = mem([{ ...DEFAULT_SIDEKICK, type: "sidekick" }, { id: "settings", type: "settings", muted: { rulo: ["gap"] } }]);
    await expect(s.store.mute("rulo", "Rulo", "vague", "2026-10-27T09:00:00Z")).rejects.toThrow(/No sidekick/);
    expect(s.writes).toEqual([]);
    await s.store.saveSidekick({ name: "Rulo", mark: "x", personality: "", purposes: [{ id: "mentor" }] });
    expect((await s.store.settings()).muted).toEqual({});
    const d = mem([]);
    await d.store.mute("sidekick", "Sidekick", "vague", "2026-10-27T09:00:00Z");
    expect((await d.store.settings()).muted).toEqual({ sidekick: ["vague"] });
  });

  it("reorder rewrites order 0..n by the given ids", async () => {
    const s = mem([{ ...DEFAULT_SIDEKICK, type: "sidekick" }, RULO]);
    await s.store.reorder(["rulo", "sidekick"]);
    expect((await s.store.sidekicks()).map((k) => [k.id, k.order])).toEqual([["rulo", 0], ["sidekick", 1]]);
  });

  it("removing deletes the record, its scope records and its muted kinds; the last one can't go", async () => {
    const s = mem([
      { ...DEFAULT_SIDEKICK, type: "sidekick" },
      RULO,
      { id: "s-main-rulo", type: "scope", scope: "main", sidekick: "rulo", on: false },
      { id: "s-main-sidekick", type: "scope", scope: "main", sidekick: "sidekick", on: false },
      { id: "settings", type: "settings", muted: { rulo: ["gap"] } },
    ]);
    await s.store.removeSidekick("rulo");
    expect(s.deleted).toEqual(["rulo", "s-main-rulo", "settings"]);
    expect(await s.store.settings()).toMatchObject({ muted: {} });
    await expect(s.store.removeSidekick("sidekick")).rejects.toThrow(/at least one/);
  });

  it("removing an unknown id or `__proto__` changes nothing", async () => {
    const s = mem([{ ...DEFAULT_SIDEKICK, type: "sidekick" }, RULO, { id: "settings", type: "settings", on: true }]);
    await expect(s.store.removeSidekick("__proto__")).rejects.toThrow(/No sidekick/);
    expect(s.writes).toEqual([]);
  });

  it("refusals write nothing: removing the implicit default, a scope for an unknown sidekick", async () => {
    const s = mem([]);
    await expect(s.store.removeSidekick("sidekick")).rejects.toThrow(/at least one/);
    await expect(s.store.setScope("main", "rulo", { on: false })).rejects.toThrow(/No sidekick/);
    expect(s.writes).toEqual([]);
  });

  it("two quick saves: the default written once, two distinct ids", async () => {
    const s = mem([]);
    const [a, b] = await Promise.all([
      s.store.saveSidekick({ name: "Rulo", mark: "x", personality: "", purposes: [{ id: "mentor" }] }),
      s.store.saveSidekick({ name: "Rulo", mark: "x", personality: "", purposes: [{ id: "mentor" }] }),
    ]);
    expect([a.id, b.id]).toEqual(["rulo", "rulo-2"]);
    expect((await s.store.sidekicks()).map((k) => [k.id, k.order])).toEqual([["sidekick", 0], ["rulo", 1], ["rulo-2", 2]]);
    expect(s.writes).toHaveLength(3);
  });

  it("a scope id another pair already holds gets a hashed one", async () => {
    const s = mem([{ ...DEFAULT_SIDEKICK, type: "sidekick" }, { ...RULO, id: "b-c" }, { ...RULO, id: "c", order: 2 }]);
    await s.store.setScope("a", "b-c", { on: false });
    await s.store.setScope("a-b", "c", { on: false });
    expect(s.records.filter((r) => r.type === "scope").map((r) => r.id)).toEqual(["s-a-b-c", expect.stringMatching(/^s-[0-9a-f]{32}$/)]);
    expect(await s.store.scopeFor("a", "b-c")).toEqual({ on: false });
    expect(await s.store.scopeFor("a-b", "c")).toEqual({ on: false });
  });

  it("scope records: setScope writes s-<scope>-<sidekick>; on by default when absent", async () => {
    const s = mem([]);
    await s.store.setScope("main", "sidekick", { on: false, purposeText: "No spec without AC." });
    expect(s.writes.at(-1)).toMatchObject({ op: "put", record: { id: "s-main-sidekick", type: "scope", scope: "main", sidekick: "sidekick", on: false, purposeText: "No spec without AC." } });
    expect(await s.store.scopeFor("main", "sidekick")).toEqual({ on: false, purposeText: "No spec without AC." });
    expect(await s.store.scopeFor("main", "rulo")).toEqual({ on: true });
  });

  it("defaultOn (spec §2a.1): a scope with no record uses it; a record wins", async () => {
    const s = mem([{ ...DEFAULT_SIDEKICK, type: "sidekick" }, { ...RULO, defaultOn: false }]);
    expect(await s.store.scopeFor("main", "rulo")).toEqual({ on: false });
    expect(await s.store.scopeFor("main", "sidekick")).toEqual({ on: true });
    await s.store.setScope("main", "rulo", { on: true });
    expect(await s.store.scopeFor("main", "rulo")).toEqual({ on: true });
    expect(await s.store.scopeFor("docs", "rulo")).toEqual({ on: false });
  });

  it("the collection schema accepts a sidekick with defaultOn and the store reads it back", async () => {
    const { s } = await store();
    const saved = await s.saveSidekick({ name: "Rulo", mark: "x", personality: "", purposes: [{ id: "mentor" }], defaultOn: false });
    expect((await s.sidekicks()).find((k) => k.id === saved.id)).toEqual({ id: "rulo", name: "Rulo", mark: "x", personality: "", purposes: [{ id: "mentor" }], order: 1, defaultOn: false });
    expect(await s.scopeFor("main", "rulo")).toEqual({ on: false });
  });
});
