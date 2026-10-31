import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectionSchema, z } from "@humanharness/harness-sdk";
import type { DataRow, DataSource } from "@humanharness/search";
import { APP_SCOPE, DataStore } from "@humanharness/workspace";
import { type PluginSearch, runningPlugins, searchData, searchableCollection } from "../src/main/search/data-sources";
import { inProcessBuild } from "../src/main/search/runner";
import { SearchService } from "../src/main/search/service";
import { searchDir } from "../src/main/search/store";

const collections = {
  people: collectionSchema.parse({ scoped: false, key: "id", agent: "none", schema: z.object({ id: z.string(), name: z.string() }), search: { title: "name" } }),
};
let tmp: string;
let a: string;
let b: string;
let userData: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hh-search-wiring-"));
  a = path.join(tmp, "A");
  b = path.join(tmp, "B");
  userData = path.join(tmp, "userData");
  for (const d of [a, b]) fs.mkdirSync(d, { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ctx = { who: "app" as const, scope: APP_SCOPE };
const NOTES: DataSource = { id: "plugin:notes/items", owner: "plugin", plugin: "notes", pluginName: "Notes", collection: "items", folder: "_app", stamp: "1" };

function wired(o: { plugins?: PluginSearch; dataDelayMs?: number } = {}) {
  let current: string | null = a;
  const stores = new Map<string, DataStore>();
  const store = (base: string) => {
    if (!stores.has(base)) stores.set(base, new DataStore(base, collections));
    return stores.get(base)!;
  };
  const data = searchData({
    current: async () => current,
    collections: () => collections,
    scoped: () => false,
    scopes: async () => [],
    store,
    plugins: () => o.plugins ?? null,
  });
  const svc = new SearchService({
    userData: () => userData,
    base: async () => current,
    scoped: () => false,
    openScope: async () => null,
    scopeTitles: async () => new Map(),
    references: async () => [],
    memory: async () => [],
    extraDenied: async () => [],
    status: () => {},
    runner: inProcessBuild(),
    reveal: vi.fn(async () => true),
    storeDelayMs: 10,
    data,
    ...(o.dataDelayMs !== undefined ? { dataDelayMs: o.dataDelayMs } : {}),
  });
  return { svc, store, data, setCurrent: (c: string | null) => (current = c) };
}
const indexOf = (base: string) => {
  const dir = searchDir(userData, base);
  return ["index.json", "files.json"].map((f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), "utf8") : "")).join("\n");
};

describe("search data wiring (search spec D4): no index ever crosses profiles", () => {
  it("after a profile switch, a refresh of the old index reads nothing of the new profile", async () => {
    const t = wired();
    await t.store(a).put("people", { id: "1", name: "Annabel" }, ctx);
    await t.svc.query("", {});
    await t.svc.whenIdle();
    t.setCurrent(b);
    await t.store(b).put("people", { id: "2", name: "Bartholomew" }, ctx);
    t.svc.dataChanged();
    await t.svc.whenIdle();
    await t.svc.flush();
    const old = indexOf(a);
    expect(old).toContain("Annabel");
    expect(old).not.toContain("Bartholomew");
  });

  it("the new profile's index, once ⌘K swaps to it, has its own records only", async () => {
    const t = wired();
    await t.store(a).put("people", { id: "1", name: "Annabel" }, ctx);
    await t.svc.query("", {});
    t.setCurrent(b);
    await t.store(b).put("people", { id: "2", name: "Bartholomew" }, ctx);
    const answer = await t.svc.query("bartholomew", {});
    expect(answer.ok && answer.counts.data).toBe(1);
    const other = await t.svc.query("annabel", {});
    expect(other.ok && other.counts.data).toBe(0);
    await t.svc.flush();
  });

  it("an invalid config (no active base) keeps the index's records", async () => {
    const t = wired();
    await t.store(a).put("people", { id: "1", name: "Annabel" }, ctx);
    await t.svc.query("", {});
    t.setCurrent(null);
    t.svc.dataChanged();
    await t.svc.whenIdle();
    await t.svc.flush();
    expect(indexOf(a)).toContain('"title":"Annabel"');
  });

  it("a plugin list that fails keeps every record, and is logged once until it works again", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const plugins = {
      searchSources: vi.fn(async () => [NOTES] as DataSource[] | null),
      searchRows: vi.fn(async () => [{ key: "n", title: "Groceries", text: "", at: 0 }] as DataRow[] | null),
    };
    const t = wired({ plugins });
    await t.store(a).put("people", { id: "1", name: "Annabel" }, ctx);
    await t.svc.query("", {});
    plugins.searchSources.mockRejectedValue(new Error("broken"));
    for (let i = 0; i < 3; i++) {
      t.svc.dataChanged();
      await t.svc.whenIdle();
    }
    await t.svc.flush();
    expect(indexOf(a)).toContain('"title":"Annabel"');
    expect(indexOf(a)).toContain('"title":"Groceries"');
    expect(errors.mock.calls.filter(([m]) => m === "Could not list the searchable collections")).toHaveLength(1);
  });

  it("plugins are asked for the live index's base only; one that answers null (another base) keeps its records", async () => {
    const plugins = {
      searchSources: vi.fn(async (base: string) => (base === a ? [NOTES] : null)),
      searchRows: vi.fn(async (_p: string, _c: string, base: string) => (base === a ? [{ key: "n", title: "Groceries", text: "", at: 0 }] : null)),
    };
    const t = wired({ plugins });
    await t.svc.query("", {});
    expect(plugins.searchRows).toHaveBeenCalledWith("notes", "items", a);
    plugins.searchSources.mockResolvedValue(null);
    t.setCurrent(b);
    t.svc.dataChanged();
    await t.svc.whenIdle();
    await t.svc.flush();
    expect(plugins.searchSources.mock.calls.every(([base]) => base === a)).toBe(true);
    expect(indexOf(a)).toContain('"title":"Groceries"');
  });

  it("D0: a change before search was first opened reads nothing", async () => {
    const plugins = { searchSources: vi.fn(async () => [] as DataSource[] | null), searchRows: vi.fn(async () => [] as DataRow[] | null) };
    const t = wired({ plugins, dataDelayMs: 5 });
    t.svc.dataChanged();
    await new Promise((r) => setTimeout(r, 20));
    await t.svc.whenIdle();
    expect(plugins.searchSources).not.toHaveBeenCalled();
    expect(fs.existsSync(searchDir(userData, a))).toBe(false);
  });

  it("a burst of changes within dataDelayMs is one refresh, at its end", async () => {
    const plugins = { searchSources: vi.fn(async () => [] as DataSource[] | null), searchRows: vi.fn(async () => [] as DataRow[] | null) };
    const t = wired({ plugins, dataDelayMs: 30 });
    await t.svc.query("", {});
    const before = plugins.searchSources.mock.calls.length;
    for (let i = 0; i < 5; i++) t.svc.dataChanged();
    expect(plugins.searchSources.mock.calls.length).toBe(before);
    await t.svc.whenIdle();
    expect(plugins.searchSources.mock.calls.length).toBe(before + 1);
    await t.svc.flush();
  });

  it("only searchable collections and a change in which plugins run ask for a refresh", () => {
    expect(searchableCollection({ ...collections, plain: { ...collections.people, search: undefined } }, "people")).toBe(true);
    expect(searchableCollection({ ...collections, plain: { ...collections.people, search: undefined } }, "plain")).toBe(false);
    expect(searchableCollection(collections, "toString")).toBe(false);
    const row = (id: string, status: "on" | "off", extra = {}) => ({ id, name: id, version: "1.0.0", origin: "bundled" as const, status, ...extra });
    const on = runningPlugins({ local: false, plugins: [row("b", "on"), row("a", "on"), row("c", "off")] });
    expect(runningPlugins({ local: false, plugins: [row("a", "on", { lastSync: "now" }), row("b", "on"), row("c", "off", { lastError: "x" })] })).toBe(on);
    expect(runningPlugins({ local: false, plugins: [row("a", "on"), row("b", "off")] })).not.toBe(on);
    expect(runningPlugins({ local: false, plugins: [row("a", "on"), { ...row("b", "on"), version: "2.0.0" }] })).not.toBe(on);
  });
});
