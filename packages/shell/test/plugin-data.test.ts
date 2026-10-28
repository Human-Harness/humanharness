import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@humanharness/harness-sdk";
import { PLUGIN_DATA_LIMITS, PluginData } from "../src/main/plugin-data";

const base = { id: "oncall", name: "On-call", version: "1.0.0", api: 1, harness: "*", permissions: {} };
const manifest = parsePluginManifest({
  ...base,
  data: {
    queues: { scoped: false, key: "key", agent: "read", schema: { type: "object", properties: { key: { type: "string" }, n: { type: "integer" } }, required: ["key"] } },
    hidden: { scoped: false, key: "key", agent: "none", schema: { type: "object", properties: { key: { type: "string" } }, required: ["key"] } },
  },
});
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "hh-pl-data-"));

describe("PluginData (plugins spec §4.2 ctx.data, D10, B4, B11)", () => {
  it("writes as the app into .harness/plugin-data/<id>/", async () => {
    const base = await tmp();
    const d = new PluginData(base, manifest);
    await d.put("queues", { key: "DOC-1", n: 1 });
    expect(await d.get("queues", "DOC-1")).toEqual({ key: "DOC-1", n: 1 });
    await expect(fs.access(path.join(base, ".harness", "plugin-data", "oncall", "_app", "queues.json"))).resolves.toBeUndefined();
    await expect(fs.access(path.join(base, ".harness", "data"))).rejects.toThrow();
  });

  it("put, patch, query, delete and replaceAll", async () => {
    const d = new PluginData(await tmp(), manifest);
    await d.put("queues", { key: "a", n: 1 });
    await d.patch("queues", "a", { n: 2 });
    expect((await d.query("queues", { where: { n: 2 } })).records).toEqual([{ key: "a", n: 2 }]);
    await d.replaceAll("queues", [{ key: "b" }, { key: "c", n: 3 }]);
    await d.delete("queues", "b");
    expect(await d.readAll("queues")).toEqual([{ key: "c", n: 3 }]);
  });

  it("B4: only its own collections", async () => {
    const d = new PluginData(await tmp(), manifest);
    await expect(d.put("notes", { key: "x" })).rejects.toThrow(/no collection/);
    await expect(d.get("other.queues", "x")).rejects.toThrow(/no collection/);
    await expect(d.replaceAll("__proto__", [])).rejects.toThrow(/no collection/);
  });

  it("B11: caps records per collection, bytes per record and bytes per collection", async () => {
    const d = new PluginData(await tmp(), manifest);
    await expect(d.put("queues", { key: "x".repeat(PLUGIN_DATA_LIMITS.recordBytes) })).rejects.toThrow(/too large/);
    const many = Array.from({ length: PLUGIN_DATA_LIMITS.records + 1 }, (_, i) => ({ key: `k${i}` }));
    await expect(d.replaceAll("queues", many)).rejects.toThrow(/at most/);
    await d.replaceAll("queues", many.slice(0, PLUGIN_DATA_LIMITS.records));
    await expect(d.put("queues", { key: "one-more" })).rejects.toThrow(/at most 2000/);
    await d.put("queues", { key: "k0", n: 1 });
    const big = Array.from({ length: 40 }, (_, i) => ({ key: `${i}`.padEnd(60 * 1024, "x") }));
    await expect(d.replaceAll("queues", big)).rejects.toThrow(/at most 2 MB/);
    await d.replaceAll("queues", [{ key: "a" }]);
    // Measured as stored: a field the schema strips doesn't count.
    await d.patch("queues", "a", { key: "a", pad: "x".repeat(PLUGIN_DATA_LIMITS.recordBytes) });
    expect(await d.readAll("queues")).toEqual([{ key: "a" }]);
  });

  it("B11: the 2 MB cap is the file as written, so nested records can't inflate it", async () => {
    const nested = parsePluginManifest({
      ...base,
      data: { q: { scoped: false, key: "key", agent: "read", schema: { type: "object", properties: { key: { type: "string" }, a: { type: "array", items: { type: "array", items: { type: "integer" } } } }, required: ["key"] } } },
    });
    const root = await tmp();
    const d = new PluginData(root, nested);
    const recs = Array.from({ length: 60 }, (_, i) => ({ key: `k${i}`, a: Array.from({ length: 1500 }, () => [0]) }));
    expect(JSON.stringify(recs).length).toBeLessThan(PLUGIN_DATA_LIMITS.fileBytes);
    await expect(d.replaceAll("q", recs)).rejects.toThrow(/too large/);
    await expect(fs.access(path.join(root, ".harness", "plugin-data", "oncall", "_app", "q.json"))).rejects.toThrow();
    for (const r of recs.slice(0, 20)) await d.put("q", r).catch(() => undefined);
    const st = await fs.stat(path.join(root, ".harness", "plugin-data", "oncall", "_app", "q.json"));
    expect(st.size).toBeLessThanOrEqual(PLUGIN_DATA_LIMITS.fileBytes);
  });

  it("B11: a schema default counts toward the 64 KB record cap", async () => {
    const withDefault = parsePluginManifest({
      ...base,
      data: { q: { scoped: false, key: "key", agent: "read", schema: { type: "object", properties: { key: { type: "string" }, b: { type: "string", default: "x".repeat(100_000) } }, required: ["key"] } } },
    });
    const d = new PluginData(await tmp(), withDefault);
    await expect(d.put("q", { key: "a" })).rejects.toThrow(/too large/);
    await expect(d.replaceAll("q", [{ key: "a" }])).rejects.toThrow(/too large/);
  });

  it("B11: a file over the cap can still be shrunk or cleared", async () => {
    const root = await tmp();
    const file = path.join(root, ".harness", "plugin-data", "oncall", "_app", "queues.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    const recs = Array.from({ length: 1000 }, (_, i) => ({ key: `k${String(i).padStart(4, "0")}`.padEnd(3000, "x") }));
    await fs.writeFile(file, JSON.stringify(recs, null, 2));
    const d = new PluginData(root, manifest);
    expect(await d.readAll("queues")).toHaveLength(1000);
    await d.delete("queues", recs[0]!.key);
    expect(await d.readAll("queues")).toHaveLength(999);
    await d.replaceAll("queues", []);
    expect(await d.readAll("queues")).toEqual([]);
    await fs.writeFile(file, JSON.stringify([...recs, ...recs.map((r) => ({ key: `${r.key}y` }))], null, 2));
    await expect(d.readAll("queues")).rejects.toThrow(/too large/);
    await d.replaceAll("queues", [{ key: "fresh" }]);
    expect(await d.readAll("queues")).toEqual([{ key: "fresh" }]);
  });

  it("replaceAll refuses records that aren't a list as invalid data", async () => {
    const d = new PluginData(await tmp(), manifest);
    for (const bad of ["abc", null, { key: "a" }, 3]) {
      await expect(d.replaceAll("queues", bad as never)).rejects.toMatchObject({ name: "DataError", code: "invalid" });
    }
  });

  it("the agent reads it read-only through agentRequest", async () => {
    const d = new PluginData(await tmp(), manifest);
    await d.put("queues", { key: "DOC-1", n: 1 });
    await d.put("hidden", { key: "h" });
    expect(await d.agentRequest({ op: "get", collection: "queues", key: "DOC-1" })).toEqual({ key: "DOC-1", n: 1 });
    await expect(d.agentRequest({ op: "put", collection: "queues", record: { key: "x" } })).rejects.toThrow(/refused|not/);
    await expect(d.agentRequest({ op: "delete", collection: "queues", key: "DOC-1" })).rejects.toThrow(/read-only/);
    await expect(d.agentRequest({ op: "get", collection: "hidden", key: "h" })).rejects.toThrow(/not available/);
    expect(await d.readAll("queues")).toEqual([{ key: "DOC-1", n: 1 }]);
  });

  it("never writes through a link the agent planted in the base", async () => {
    const base = await tmp();
    const outside = await tmp();
    await fs.mkdir(path.join(base, ".harness"), { recursive: true });
    await fs.symlink(outside, path.join(base, ".harness", "plugin-data"));
    const d = new PluginData(base, manifest);
    await expect(d.put("queues", { key: "a" })).rejects.toThrow(/not a plain folder/);
    expect(await fs.readdir(outside)).toEqual([]);
  });
});
