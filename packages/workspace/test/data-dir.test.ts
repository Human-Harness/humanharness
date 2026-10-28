import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectionSchema, z } from "@humanharness/harness-sdk";
import { APP_SCOPE, DataStore } from "../src/index";

const items = { items: collectionSchema.parse({ scoped: false, key: "id", agent: "read", schema: z.object({ id: z.string(), n: z.number() }) }) };
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "hh-data-dir-"));
const app = { who: "app" as const, scope: APP_SCOPE };

describe("DataStore dir option (plugins spec §3.3)", () => {
  it("D0: without dir, files go where they always did", async () => {
    const base = await tmp();
    await new DataStore(base, items).put("items", { id: "a", n: 1 }, app);
    await expect(fs.access(path.join(base, ".harness", "data", "_app", "items.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(base, ".harness", "data-meta", "_app", "items.json"))).resolves.toBeUndefined();
  });

  it("with dir, records go to <dir>/<scope>/<collection>.json and meta to <dir>/.meta/", async () => {
    const base = await tmp();
    const dir = path.join(base, ".harness", "plugin-data", "oncall");
    const s = new DataStore(base, items, { dir });
    await s.put("items", { id: "a", n: 1 }, app);
    expect(JSON.parse(await fs.readFile(path.join(dir, "_app", "items.json"), "utf8"))).toEqual([{ id: "a", n: 1 }]);
    await expect(fs.access(path.join(dir, ".meta", "_app", "items.json"))).resolves.toBeUndefined();
    expect(Object.keys(await s.changedAt("items", APP_SCOPE))).toEqual(["a"]);
    await expect(fs.access(path.join(base, ".harness", "data"))).rejects.toThrow();
    await expect(fs.access(path.join(base, ".harness", "data-meta"))).rejects.toThrow();
  });

  it("with dir, a single collection's delete removes its own file", async () => {
    const base = await tmp();
    const dir = path.join(base, "own");
    const one = { one: collectionSchema.parse({ scoped: false, single: true, agent: "read", schema: z.object({ n: z.number() }) }) };
    const s = new DataStore(base, one, { dir });
    await s.put("one", { n: 1 }, app);
    expect(await s.delete("one", undefined, app)).toBe(true);
    await expect(fs.access(path.join(dir, "_app", "one.json"))).rejects.toThrow();
  });
});

describe("replaceAll (§4.2)", () => {
  it("replaces every record in one write, checked like put", async () => {
    const s = new DataStore(await tmp(), items);
    const changes: unknown[] = [];
    s.onChange((c) => changes.push(c));
    await s.put("items", { id: "old", n: 0 }, app);
    await s.replaceAll("items", [{ id: "b", n: 2 }, { id: "a", n: 1 }], app);
    expect((await s.readAll("items", APP_SCOPE)).records).toEqual([{ id: "a", n: 1 }, { id: "b", n: 2 }]);
    expect(changes.at(-1)).toEqual({ collection: "items", scope: APP_SCOPE, who: "app", op: "replaceAll" });
    expect(Object.keys(await s.changedAt("items", APP_SCOPE)).sort()).toEqual(["a", "b"]);
  });
  it("refuses a duplicate key or an invalid record and leaves the file as it was", async () => {
    const s = new DataStore(await tmp(), items);
    await s.put("items", { id: "keep", n: 0 }, app);
    await expect(s.replaceAll("items", [{ id: "a", n: 1 }, { id: "a", n: 2 }], app)).rejects.toThrow(/twice|duplicate/);
    await expect(s.replaceAll("items", [{ id: "a", n: "x" }], app)).rejects.toThrow();
    expect((await s.readAll("items", APP_SCOPE)).records).toEqual([{ id: "keep", n: 0 }]);
  });
  it("the agent can't replaceAll a read collection", async () => {
    const s = new DataStore(await tmp(), items);
    await expect(s.replaceAll("items", [], { who: "agent", scope: APP_SCOPE })).rejects.toThrow(/refused|not/);
  });
  it("runs the rules for each new, changed and removed record against the previous file", async () => {
    const seen: [unknown, unknown][] = [];
    const ruled = {
      items: collectionSchema.parse({
        scoped: false,
        key: "id",
        agent: "read",
        schema: z.object({ id: z.string(), n: z.number() }),
        rules: (next: { n: number } | null, prev: unknown) => {
          seen.push([next, prev]);
          return next === null || next.n < 10 || "too big";
        },
      }),
    };
    const s = new DataStore(await tmp(), ruled);
    await s.put("items", { id: "same", n: 1 }, app);
    await s.put("items", { id: "gone", n: 2 }, app);
    await s.put("items", { id: "changed", n: 3 }, app);
    seen.length = 0;
    await s.replaceAll("items", [{ id: "same", n: 1 }, { id: "changed", n: 4 }, { id: "new", n: 5 }], app);
    expect(seen).toEqual([
      [{ id: "changed", n: 4 }, { id: "changed", n: 3 }],
      [{ id: "new", n: 5 }, null],
      [null, { id: "gone", n: 2 }],
    ]);
    await expect(s.replaceAll("items", [{ id: "x", n: 99 }], app)).rejects.toThrow(/too big/);
    expect((await s.readAll("items", APP_SCOPE)).records.map((r) => r.id)).toEqual(["changed", "new", "same"]);
  });
});

describe("a store with its own folder never goes through a link (the agent can plant one in the base)", () => {
  const setup = async () => {
    const base = await tmp();
    const outside = await tmp();
    const dir = path.join(base, ".harness", "plugin-data", "oncall");
    return { base, outside, dir, s: new DataStore(base, items, { dir }) };
  };

  it("refuses a linked folder anywhere between the base and the file, and writes nothing outside", async () => {
    for (const linked of [".harness", ".harness/plugin-data", ".harness/plugin-data/oncall", ".harness/plugin-data/oncall/_app"]) {
      const { base, outside, s } = await setup();
      const at = path.join(base, ...linked.split("/"));
      await fs.mkdir(path.dirname(at), { recursive: true });
      await fs.symlink(outside, at);
      await expect(s.put("items", { id: "a", n: 1 }, app)).rejects.toThrow(/not a plain folder/);
      await expect(s.readAll("items", APP_SCOPE)).rejects.toThrow(/not a plain folder/);
      expect(await fs.readdir(outside)).toEqual([]);
    }
  });

  it("refuses a linked file: neither read through nor replaced, and the target is untouched", async () => {
    const { outside, dir, s } = await setup();
    const target = path.join(outside, "secret.json");
    await fs.writeFile(target, '[{"id":"x","n":1}]');
    await fs.mkdir(path.join(dir, "_app"), { recursive: true });
    await fs.symlink(target, path.join(dir, "_app", "items.json"));
    await expect(s.readAll("items", APP_SCOPE)).rejects.toThrow(/link|plain file/);
    await expect(s.replaceAll("items", [], app)).rejects.toThrow(/link|plain file/);
    expect(await fs.readFile(target, "utf8")).toBe('[{"id":"x","n":1}]');
  });

  it("refuses a hard-linked file: not read, not replaced", async () => {
    const { outside, dir, s } = await setup();
    const target = path.join(outside, "other.json");
    await fs.writeFile(target, '[{"id":"x","n":1}]');
    await fs.mkdir(path.join(dir, "_app"), { recursive: true });
    await fs.link(target, path.join(dir, "_app", "items.json"));
    await expect(s.readAll("items", APP_SCOPE)).rejects.toThrow(/plain file/);
    await expect(s.put("items", { id: "a", n: 1 }, app)).rejects.toThrow(/plain file/);
    expect(await fs.readFile(target, "utf8")).toBe('[{"id":"x","n":1}]');
  });

  it("refuses a linked meta file without writing through it", async () => {
    const { outside, dir, s } = await setup();
    const target = path.join(outside, "meta.json");
    await fs.writeFile(target, "{}");
    await fs.mkdir(path.join(dir, ".meta", "_app"), { recursive: true });
    await fs.symlink(target, path.join(dir, ".meta", "_app", "items.json"));
    await s.put("items", { id: "a", n: 1 }, { ...app });
    expect(await fs.readFile(target, "utf8")).toBe("{}");
    expect(await s.changedAt("items", APP_SCOPE)).toEqual({});
  });

  it("refuses a file over the size cap", async () => {
    const base = await tmp();
    const dir = path.join(base, "own");
    await fs.mkdir(path.join(dir, "_app"), { recursive: true });
    await fs.writeFile(path.join(dir, "_app", "items.json"), `[${" ".repeat(200)}]`);
    await expect(new DataStore(base, items, { dir, maxFileBytes: 100 }).readAll("items", APP_SCOPE)).rejects.toThrow(/too large/);
  });

  it("deletes a single record's file, but not through a linked folder", async () => {
    const { base, outside } = await setup();
    const one = { one: collectionSchema.parse({ scoped: false, single: true, agent: "read", schema: z.object({ n: z.number() }) }) };
    await fs.writeFile(path.join(outside, "one.json"), '{"n":1}');
    await fs.mkdir(path.join(base, "own"));
    await fs.symlink(outside, path.join(base, "own", "_app"));
    await expect(new DataStore(base, one, { dir: path.join(base, "own") }).delete("one", undefined, app)).rejects.toThrow(/not a plain folder/);
    expect(await fs.readFile(path.join(outside, "one.json"), "utf8")).toBe('{"n":1}');
  });
});
