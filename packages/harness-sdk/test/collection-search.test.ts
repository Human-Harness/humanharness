import { describe, expect, it } from "vitest";
import { z } from "zod";
import { collectionSchema, searchFields } from "../src/data";
import { parsePluginManifest, pluginCollections } from "../src/plugin";

const people = { scoped: false, key: "id", agent: "none" as const, schema: z.object({ id: z.string(), name: z.string(), bio: z.string().optional() }) };

describe("search on a harness collection (search spec D4, §7)", () => {
  it("is optional: a collection without it parses as before", () => {
    expect(collectionSchema.parse(people)).not.toHaveProperty("search");
  });

  it("names fields of the schema: a title and one or up to five text fields", () => {
    const c = collectionSchema.parse({ ...people, search: { title: "name", text: ["bio"] } });
    expect(c.search).toEqual({ title: "name", text: ["bio"] });
    expect(searchFields(c.search!)).toEqual(["name", "bio"]);
    expect(searchFields({ title: "name", text: "bio" })).toEqual(["name", "bio"]);
    expect(searchFields({ title: "name" })).toEqual(["name"]);
    expect(collectionSchema.safeParse({ ...people, search: { title: "name", text: ["a", "b", "c", "d", "e", "f"] } }).success).toBe(false);
  });

  it("refuses a field the schema doesn't have", () => {
    const r = collectionSchema.safeParse({ ...people, search: { title: "nope", text: "bio" } });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain('"nope" is not a field of the schema');
  });

  it('a collection hidden from the agent (agent: "none") may set it: search is the person\'s', () => {
    expect(collectionSchema.safeParse({ ...people, search: { title: "name" } }).success).toBe(true);
  });
});

const plugin = (search: unknown, panels = [{ id: "main", title: "Main" }]) => ({
  id: "mini",
  name: "Mini",
  version: "0.1.0",
  api: 1,
  harness: "*",
  permissions: {},
  data: {
    items: {
      key: "id",
      agent: "read",
      schema: { type: "object", properties: { id: { type: "string" }, title: { type: "string" }, body: { type: "string" } }, required: ["id"] },
      search,
    },
  },
  panels,
});

describe("search on a plugin collection", () => {
  it("names fields of its JSON schema and, optionally, the panel a record opens in", () => {
    const m = parsePluginManifest(plugin({ title: "title", text: ["body"], panel: "main" }));
    expect(m.data.items.search).toEqual({ title: "title", text: ["body"], panel: "main" });
    // The data model keeps the fields; the panel is the plugin's own business.
    expect(pluginCollections(m).items.search).toEqual({ title: "title", text: ["body"] });
  });

  it("refuses an unknown field, an unknown panel and an unknown key", () => {
    expect(() => parsePluginManifest(plugin({ title: "nope" }))).toThrow(/nope.{0,2} is not a field of the schema/);
    expect(() => parsePluginManifest(plugin({ title: "title", panel: "side" }))).toThrow(/side.{0,2} is not a declared panel/);
    expect(() => parsePluginManifest(plugin({ title: "title", extra: 1 }))).toThrow();
  });
});
