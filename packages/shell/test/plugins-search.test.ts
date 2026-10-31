import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePluginManifest } from "@humanharness/harness-sdk";
import { PluginData } from "../src/main/plugin-data";
import { bundled, setup } from "./plugins-fixtures";

const ITEMS = {
  key: "key",
  agent: "read",
  schema: { type: "object", properties: { key: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["key"] },
  search: { title: "title", text: "body" },
};

async function running(over: Record<string, unknown>) {
  const t = await setup({ plugins: { bundled: ["notes"], on: ["notes"], local: false } });
  const dist = await bundled(t.root, "notes", { name: "Notes", data: { items: ITEMS }, ...over });
  await t.ctl.start();
  const manifest = parsePluginManifest(JSON.parse(await fs.readFile(path.join(dist, "plugin.json"), "utf8")));
  return { ...t, store: new PluginData(t.base, manifest) };
}

describe("PluginsController search (search spec D4, §7)", () => {
  it("lists a running plugin's searchable collections; its panel defaults to the first; the stamp follows the file", async () => {
    const t = await running({ panels: [{ id: "list", title: "List" }, { id: "side", title: "Side" }] });
    const [s] = await t.ctl.searchSources();
    expect(s).toMatchObject({ id: "plugin:notes/items", owner: "plugin", plugin: "notes", pluginName: "Notes", panel: "list", collection: "items", folder: "_app" });
    expect(s.stamp).toMatch(/^none\|none#[0-9a-z]+:list$/);
    await t.store.put("items", { key: "a", title: "Groceries", body: "milk and eggs" });
    const [after] = await t.ctl.searchSources();
    expect(after.stamp).not.toBe(s.stamp);
    expect(await t.ctl.searchRows("notes", "items")).toEqual([{ key: "a", title: "Groceries", text: "milk and eggs", at: expect.any(Number) }]);
  });

  it("no panel: none named; a collection without search, a stopped plugin, an unknown one: nothing", async () => {
    const t = await running({ data: { items: ITEMS, plain: { ...ITEMS, search: undefined } } });
    const sources = await t.ctl.searchSources();
    expect(sources.map((s) => s.id)).toEqual(["plugin:notes/items"]);
    expect(sources[0]).not.toHaveProperty("panel");
    expect(await t.ctl.searchRows("notes", "plain")).toEqual([]);
    expect(await t.ctl.searchRows("other", "items")).toEqual([]);
    await t.ctl.setOn("notes", false);
    expect(await t.ctl.searchSources()).toEqual([]);
    expect(await t.ctl.searchRows("notes", "items")).toEqual([]);
  });

  it("rows come from recordRows: a token-shaped key is skipped, token-shaped lines leave the text", async () => {
    const t = await running({});
    const token = `ghp_${"a1B2".repeat(9)}`;
    await t.store.put("items", { key: token, title: "Secret key", body: "hidden" });
    await t.store.put("items", { key: "ok", title: "Fine", body: `line one\n${token}\nline two` });
    const rows = await t.ctl.searchRows("notes", "items");
    expect(rows).toEqual([{ key: "ok", title: "Fine", text: "line one\nline two", at: expect.any(Number) }]);
    expect(JSON.stringify(rows)).not.toContain("ghp_");
  });

  it("the permission review says what is searchable", async () => {
    const t = await running({});
    const detail = await t.ctl.detail("notes");
    expect(detail?.review.lines.at(-1)).toEqual({ kind: "searchable", collections: [{ name: "items", fields: ["title", "body"] }] });
  });

  it("the stamp follows the records' meta file too: a read between the two writes is read again", async () => {
    const t = await running({});
    await t.store.put("items", { key: "a", title: "Groceries", body: "milk" });
    const [before] = await t.ctl.searchSources();
    const meta = path.join(t.base, ".harness", "plugin-data", "notes", ".meta", "_app", "items.json");
    await fs.writeFile(meta, `${JSON.stringify({ a: "2026-10-31T00:00:00.000Z", b: "2026-10-31T00:00:00.000Z" })}\n`);
    const [after] = await t.ctl.searchSources();
    expect(after.stamp).not.toBe(before.stamp);
  });

  it("the stamp follows the declaration: an update that changes the key, single or search reads the records again", async () => {
    const [plain] = await (await running({})).ctl.searchSources();
    const [other] = await (await running({ data: { items: { ...ITEMS, search: { title: "body", text: "title" } } } })).ctl.searchSources();
    expect(other.stamp).not.toBe(plain.stamp);
  });

  it("search only peeks at the base the plugins run in: another base gives null and never stops them", async () => {
    const t = await running({});
    await t.store.put("items", { key: "a", title: "Groceries", body: "milk" });
    t.setBase(`${t.base}-other`);
    expect(await t.ctl.searchSources(`${t.base}-other`)).toBeNull();
    expect(await t.ctl.searchRows("notes", "items", `${t.base}-other`)).toBeNull();
    expect((await t.ctl.searchSources(t.base))?.map((s) => s.id)).toEqual(["plugin:notes/items"]);
    expect(await t.ctl.searchSources()).toHaveLength(1);
    expect(await t.ctl.searchRows("notes", "items", t.base)).toEqual([{ key: "a", title: "Groceries", text: "milk", at: expect.any(Number) }]);
    // Still running: a detach (what asking for the base does once it changed) would stop it and serve nothing.
    expect(t.ctl.panelHost("notes")).not.toBeNull();
  });
});

