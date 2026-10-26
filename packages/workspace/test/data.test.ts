import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { dataSchema, z } from "@humanharness/harness-sdk";
import { type DataChange, DataError, DataStore, dataPath, parseDataPath, runDataRequest } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "t-"));

const data = dataSchema.parse({
  concepts: { scoped: true, key: "id", schema: z.object({ id: z.string(), name: z.string(), state: z.enum(["seen", "mastered"]) }), agent: "write" },
  cards: { scoped: true, key: "n", schema: z.object({ n: z.number(), front: z.string() }), agent: "read" },
  profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" },
  secrets: { scoped: false, key: "id", schema: z.object({ id: z.string() }), agent: "none" },
});
const person = { who: "person" as const, scope: "fracciones" };
const agent = { who: "agent" as const, scope: "fracciones" };
const file = (base: string, rel: string) => path.join(base, ...rel.split("/"));

describe("data paths", () => {
  it("puts each collection in its scope's folder", () => {
    expect(dataPath("fracciones", "concepts")).toBe(".harness/data/fracciones/concepts.json");
    expect(dataPath("_app", "profile")).toBe(".harness/data/_app/profile.json");
    expect(() => dataPath("../x", "concepts")).toThrow(/scope/);
    expect(() => dataPath("main", "../x")).toThrow(/collection/);
    expect(parseDataPath(".harness/data/fracciones/concepts.json")).toEqual({ scope: "fracciones", collection: "concepts" });
    expect(parseDataPath(".harness/notes/x.md")).toBeNull();
    expect(parseDataPath(".harness/data/Bad/concepts.json")).toBeNull();
  });
});

describe("DataStore", () => {
  it("stores records sorted by key, one block each, and reads them back", async () => {
    const base = tmp();
    const store = new DataStore(base, data);
    await store.put("concepts", { id: "b", name: "B", state: "seen", extra: "dropped" }, person);
    await store.put("concepts", { id: "a", name: "A", state: "seen" }, person);
    await store.put("concepts", { id: "b", name: "B2", state: "mastered" }, person);
    expect(fs.readFileSync(file(base, ".harness/data/fracciones/concepts.json"), "utf8")).toBe(
      `${JSON.stringify(
        [
          { id: "a", name: "A", state: "seen" },
          { id: "b", name: "B2", state: "mastered" },
        ],
        null,
        2,
      )}\n`,
    );
    expect(await store.get("concepts", "b", person)).toEqual({ id: "b", name: "B2", state: "mastered" });
    expect(await store.get("concepts", "zz", person)).toBeNull();
    // Another scope has its own file.
    expect(await store.get("concepts", "b", { who: "person", scope: "decimales" })).toBeNull();
  });

  it("sorts numeric keys as numbers", async () => {
    const store = new DataStore(tmp(), data);
    for (const n of [10, 2, 1]) await store.put("cards", { n, front: `f${n}` }, person);
    expect((await store.query("cards", {}, person)).records.map((r) => r.n)).toEqual([1, 2, 10]);
  });

  it("refuses an invalid record, a missing key, an unknown collection, and a scoped one without a scope", async () => {
    const store = new DataStore(tmp(), data);
    await expect(store.put("concepts", { id: "a", name: "A", state: "nope" }, person)).rejects.toThrow(/state/);
    await expect(store.put("concepts", { name: "A", state: "seen" }, person)).rejects.toThrow(/id/);
    await expect(store.put("nope", {}, person)).rejects.toMatchObject({ code: "unknown-collection" });
    await expect(store.put("concepts", { id: "a", name: "A", state: "seen" }, { who: "person", scope: "_app" })).rejects.toMatchObject({ code: "no-scope" });
  });

  it("refuses a bad scope, a NaN limit and a missing key with DataError", async () => {
    const store = new DataStore(tmp(), data);
    await expect(store.put("concepts", { id: "a", name: "A", state: "seen" }, { who: "person", scope: "../x" })).rejects.toMatchObject({ code: "invalid" });
    await expect(store.get("profile", undefined, { who: "person", scope: "../x" })).rejects.toBeInstanceOf(DataError);
    await store.put("concepts", { id: "a", name: "A", state: "seen" }, person);
    expect((await store.query("concepts", { limit: Number.NaN }, person)).records).toHaveLength(1);
    await expect(store.get("concepts", undefined, person)).rejects.toMatchObject({ code: "invalid", message: "A key is needed" });
    await expect(store.patch("concepts", undefined, { state: "seen" }, person)).rejects.toMatchObject({ code: "invalid" });
    await expect(store.delete("concepts", undefined, person)).rejects.toMatchObject({ code: "invalid" });
  });

  it("keeps the first of duplicate keys in a hand-edited file and refuses writes until it is fixed", async () => {
    const base = tmp();
    const store = new DataStore(base, data);
    await store.put("concepts", { id: "a", name: "A", state: "seen" }, person);
    fs.writeFileSync(file(base, ".harness/data/fracciones/concepts.json"), JSON.stringify([{ id: "a", name: "A1", state: "seen" }, { id: "a", name: "A2", state: "seen" }]));
    expect(await store.query("concepts", {}, person)).toMatchObject({ records: [{ name: "A1" }], total: 1, invalid: 1 });
    await expect(store.put("concepts", { id: "b", name: "B", state: "seen" }, person)).rejects.toThrow(/\.harness\/data\/fracciones\/concepts\.json/);
  });

  it("lets the agent write only `write` collections and read none of the `none` ones", async () => {
    const store = new DataStore(tmp(), data);
    await expect(store.put("cards", { n: 1, front: "x" }, agent)).rejects.toMatchObject({ code: "refused" });
    await expect(store.put("profile", { name: "Ana" }, agent)).rejects.toMatchObject({ code: "refused" });
    await expect(store.query("secrets", {}, agent)).rejects.toMatchObject({ code: "refused" });
    await store.put("cards", { n: 1, front: "x" }, person);
    expect(await store.get("cards", 1, agent)).toEqual({ n: 1, front: "x" });
    expect(await store.put("concepts", { id: "a", name: "A", state: "seen" }, agent)).toEqual({ id: "a", name: "A", state: "seen" });
  });

  it("patches a record, keeps its key, and deletes", async () => {
    const store = new DataStore(tmp(), data);
    await store.put("concepts", { id: "a", name: "A", state: "seen" }, person);
    expect(await store.patch("concepts", "a", { state: "mastered" }, person)).toEqual({ id: "a", name: "A", state: "mastered" });
    await expect(store.patch("concepts", "a", { id: "b" }, person)).rejects.toThrow(/can't change/);
    await expect(store.patch("concepts", "zz", { state: "seen" }, person)).rejects.toMatchObject({ code: "not-found" });
    await expect(store.patch("concepts", "a", { state: "nope" }, person)).rejects.toMatchObject({ code: "invalid" });
    expect(await store.delete("concepts", "a", person)).toBe(true);
    expect(await store.delete("concepts", "a", person)).toBe(false);
    expect((await store.query("concepts", {}, person)).records).toEqual([]);
  });

  it("keeps a single record app-wide, whatever the scope, and removes its file on delete", async () => {
    const base = tmp();
    const store = new DataStore(base, data);
    await store.put("profile", { name: "Ana" }, person);
    expect(await store.get("profile", undefined, { who: "person", scope: "_app" })).toEqual({ name: "Ana" });
    expect(JSON.parse(fs.readFileSync(file(base, ".harness/data/_app/profile.json"), "utf8"))).toEqual({ name: "Ana" });
    expect(await store.patch("profile", undefined, { name: "Ana B" }, person)).toEqual({ name: "Ana B" });
    expect(await store.delete("profile", undefined, person)).toBe(true);
    expect(fs.existsSync(file(base, ".harness/data/_app/profile.json"))).toBe(false);
  });

  it("queries with equality, `in`, fields (the key always comes) and a bounded limit", async () => {
    const store = new DataStore(tmp(), data);
    for (const [id, state] of [["a", "seen"], ["b", "mastered"], ["c", "seen"]]) await store.put("concepts", { id, name: id.toUpperCase(), state }, person);
    expect(await store.query("concepts", { where: { state: "seen" }, fields: ["name"] }, person)).toEqual({
      records: [
        { id: "a", name: "A" },
        { id: "c", name: "C" },
      ],
      total: 2,
      invalid: 0,
    });
    expect((await store.query("concepts", { where: { id: { in: ["b", "c"] } } }, person)).total).toBe(2);
    expect((await store.query("concepts", { limit: 1 }, person)).records).toHaveLength(1);
    expect((await store.query("concepts", { limit: 1 }, person)).total).toBe(3);
    expect((await store.query("concepts", { limit: 10_000 }, person)).records).toHaveLength(3);
  });

  it("reads a hand-edited file again on every call, skips invalid records and refuses writes until it is fixed (spec §7.3)", async () => {
    const base = tmp();
    const store = new DataStore(base, data);
    await store.put("concepts", { id: "a", name: "A", state: "seen" }, person);
    const f = file(base, ".harness/data/fracciones/concepts.json");
    fs.writeFileSync(f, JSON.stringify([{ id: "a", name: "A", state: "seen" }, { id: "b", name: "B", state: "broken" }]));
    expect(await store.query("concepts", {}, person)).toMatchObject({ total: 1, invalid: 1 });
    await expect(store.put("concepts", { id: "c", name: "C", state: "seen" }, person)).rejects.toMatchObject({ code: "broken-file" });
    fs.writeFileSync(f, "{not json");
    await expect(store.put("concepts", { id: "c", name: "C", state: "seen" }, person)).rejects.toThrow(/\.harness\/data\/fracciones\/concepts\.json/);
    fs.writeFileSync(f, JSON.stringify([{ id: "a", name: "A by hand", state: "seen" }]));
    expect(await store.get("concepts", "a", person)).toMatchObject({ name: "A by hand" });
    await store.put("concepts", { id: "c", name: "C", state: "seen" }, person);
  });

  it("serializes writes, stamps when each record changed, and tells listeners", async () => {
    const base = tmp();
    let t = 0;
    const store = new DataStore(base, data, { now: () => new Date(Date.UTC(2026, 9, 25, 10, 0, t++)) });
    const changes: DataChange[] = [];
    const off = store.onChange((c) => changes.push(c));
    await Promise.all(["a", "b", "c"].map((id) => store.put("concepts", { id, name: id, state: "seen" }, agent)));
    expect((await store.query("concepts", {}, person)).total).toBe(3);
    expect(Object.keys(await store.changedAt("concepts", "fracciones")).sort()).toEqual(["a", "b", "c"]);
    expect(fs.readdirSync(file(base, ".harness/data/fracciones")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
    expect(changes[0]).toEqual({ collection: "concepts", scope: "fracciones", who: "agent", op: "put", key: "a" });
    off();
    await store.delete("concepts", "a", person);
    expect(changes).toHaveLength(3);
    expect(Object.keys(await store.changedAt("concepts", "fracciones")).sort()).toEqual(["b", "c"]);
  });
});

describe("runDataRequest", () => {
  it("runs a request from the tools or the client, and refuses one that isn't", async () => {
    const store = new DataStore(tmp(), data);
    expect(await runDataRequest(store, { op: "put", collection: "concepts", record: { id: "a", name: "A", state: "seen" } }, agent)).toMatchObject({ id: "a" });
    expect(await runDataRequest(store, { op: "get", collection: "concepts", key: "a" }, agent)).toMatchObject({ id: "a" });
    expect(await runDataRequest(store, { op: "query", collection: "concepts", where: { state: "seen" } }, agent)).toMatchObject({ total: 1 });
    expect(await runDataRequest(store, { op: "patch", collection: "concepts", key: "a", patch: { name: "A2" } }, agent)).toMatchObject({ name: "A2" });
    expect(await runDataRequest(store, { op: "delete", collection: "concepts", key: "a" }, agent)).toBe(true);
    await expect(runDataRequest(store, { op: "drop", collection: "concepts" }, agent)).rejects.toBeInstanceOf(DataError);
  });
});
