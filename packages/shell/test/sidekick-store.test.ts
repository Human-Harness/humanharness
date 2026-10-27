import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SIDEKICK_COLLECTION, sidekickCollection } from "@humanharness/harness-sdk";
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
