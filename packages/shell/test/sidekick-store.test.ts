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
    read: () => ds.get(SIDEKICK_COLLECTION, "settings", { who: "person", scope: APP_SCOPE }) as never,
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
    const s = new SidekickStore({ read: async () => null, write: async () => Promise.reject(new Error("The app is closing")) });
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
    const s = new SidekickStore({ read: async () => Promise.reject(new Error("disk")), write: async (r) => writes.push(r) });
    expect(await s.set({ on: true })).toEqual({ ok: false, message: "disk" });
    expect(writes).toEqual([]);
  });
});
