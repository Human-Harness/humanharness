import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dataSchema, z } from "@humanharness/harness-sdk";
import { DataStore, type HistoryTrailer } from "@humanharness/workspace";
import { type PersonDataDeps, personDataRequest } from "../src/main/data-requests";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const data = dataSchema.parse({
  concepts: { scoped: true, key: "id", schema: z.object({ id: z.string(), name: z.string() }), agent: "write" },
  profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" },
});

function setup(opts: { blocked?: string; trailer?: HistoryTrailer; open?: string } = {}) {
  const store = new DataStore(fs.mkdtempSync(path.join(root, "t-")), data);
  const commits: { message: string; trailer?: HistoryTrailer }[] = [];
  const deps: PersonDataDeps = {
    store: async () => store,
    chatScope: async () => opts.open ?? "fracciones",
    trailer: async () => opts.trailer,
    saveHistory: async (message, trailer) => void commits.push({ message, ...(trailer ? { trailer } : {}) }),
    blocked: () => opts.blocked ?? null,
  };
  return { store, deps, commits };
}

describe("personDataRequest", () => {
  it("writes in the open scope and records a Data commit tagged with the open task", async () => {
    const t = setup({ trailer: { task: "t1", action: "study", scope: "fracciones" } });
    await personDataRequest(t.deps, { op: "put", collection: "concepts", record: { id: "a", name: "A" } }, undefined);
    expect(await t.store.get("concepts", "a", { who: "person", scope: "fracciones" })).toEqual({ id: "a", name: "A" });
    expect(t.commits).toEqual([{ message: "Data: concepts", trailer: { task: "t1", action: "study", scope: "fracciones" } }]);
  });

  it("takes another scope when asked, reads with no commit, and writes read-only collections as the person", async () => {
    const t = setup();
    await personDataRequest(t.deps, { op: "put", collection: "concepts", record: { id: "a", name: "A" } }, { scope: "decimales" });
    expect(await t.store.get("concepts", "a", { who: "person", scope: "decimales" })).not.toBeNull();
    expect(await personDataRequest(t.deps, { op: "get", collection: "concepts", key: "a" }, { scope: "decimales" })).toMatchObject({ id: "a" });
    await personDataRequest(t.deps, { op: "put", collection: "profile", record: { name: "Ana" } }, undefined);
    expect(t.commits.map((c) => c.message)).toEqual(["Data: concepts", "Data: profile"]);
    expect(t.commits[0]).not.toHaveProperty("trailer");
  });

  it("refuses writes while turns are blocked, and a bad scope", async () => {
    const t = setup({ blocked: "A restore is running" });
    await expect(personDataRequest(t.deps, { op: "put", collection: "concepts", record: { id: "a", name: "A" } }, undefined)).rejects.toThrow(/restore/);
    expect(await personDataRequest(t.deps, { op: "query", collection: "concepts" }, undefined)).toMatchObject({ total: 0 });
    await expect(personDataRequest(setup().deps, { op: "get", collection: "concepts", key: "a" }, { scope: "../x" })).rejects.toThrow(/scope/);
  });

  it("records no history commit for a refused write", async () => {
    const t = setup();
    await expect(personDataRequest(t.deps, { op: "put", collection: "concepts", record: { id: "a" } }, undefined)).rejects.toThrow();
    expect(t.commits).toEqual([]);
  });
});
