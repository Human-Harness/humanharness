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

  it("takes five text fields and refuses an unknown setting", () => {
    const wide = { scoped: false, key: "id", agent: "none" as const, schema: z.object({ id: z.string(), a: z.string(), b: z.string(), c: z.string(), d: z.string(), e: z.string() }) };
    expect(collectionSchema.parse({ ...wide, search: { title: "id", text: ["a", "b", "c", "d", "e"] } }).search?.text).toHaveLength(5);
    const r = collectionSchema.safeParse({ ...people, search: { title: "name", panel: "main" } });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.code)).toContain("unrecognized_keys");
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
    // The zod error's message is the issues as JSON: the quotes around the name come escaped.
    expect(() => parsePluginManifest(plugin({ title: "nope" }))).toThrow(/nope\\?"? is not a field of the schema/);
    expect(() => parsePluginManifest(plugin({ title: "title", panel: "side" }))).toThrow(/side\\?"? is not a declared panel/);
    expect(() => parsePluginManifest(plugin({ title: "title", extra: 1 }))).toThrow(/unrecognized key|extra/i);
  });

  it("takes up to five text fields, never six", () => {
    const five = ["title", "body", "title", "body", "title"];
    expect(parsePluginManifest(plugin({ title: "title", text: five })).data.items.search?.text).toEqual(five);
    expect(() => parsePluginManifest(plugin({ title: "title", text: [...five, "body"] }))).toThrow();
  });

  it("refuses a panel when the plugin declares none", () => {
    expect(() => parsePluginManifest(plugin({ title: "title", panel: "main" }, []))).toThrow(/main\\?"? is not a declared panel/);
  });

  it("refuses any field when the JSON schema has no properties", () => {
    const m = plugin({ title: "title" });
    m.data.items.schema = { type: "object" } as typeof m.data.items.schema;
    expect(() => parsePluginManifest(m)).toThrow(/title\\?"? is not a field of the schema/);
  });
});
