import { describe, expect, it } from "vitest";
import {
  PLUGIN_API, PLUGIN_ID, PLUGIN_TIERS, TIERS, checkSchemaSubset, jsonSchemaToZod, parsePluginManifest, pluginCollections, pluginSettings, z,
} from "../src/index";

/** A minimal valid plugin.json, as `humanharness plugin build` would write it. */
export const manifest = (over: Record<string, unknown> = {}) => ({
  id: "oncall",
  name: "On-call",
  version: "1.0.0",
  api: 1,
  harness: "*",
  permissions: { hosts: ["*.atlassian.net"], exec: [{ cmd: "gh", args: ["api", "--method", "GET", "*"] }], secrets: [{ id: "jira", label: "Jira API token" }], tasks: false },
  sources: [{ id: "queues", ttl: 300, workHoursOnly: true }],
  data: {
    queues: {
      scoped: false,
      key: "key",
      agent: "read",
      schema: { type: "object", properties: { key: { type: "string" }, title: { type: "string", maxLength: 200 }, age: { type: "integer", minimum: 0 } }, required: ["key", "title"] },
      context: { fields: ["key", "title"], tokens: 200 },
    },
  },
  settings: {
    tab: "On-call",
    fields: { team: { schema: { type: "string", enum: ["docs", "web"] }, default: "docs", control: "segmented", label: "Team", agent: "Our team is {{value}}." } },
  },
  ...over,
});

describe("plugin.json (plugins spec §3.2)", () => {
  it("parses a valid manifest and fills defaults", () => {
    const m = parsePluginManifest(manifest());
    expect(m.api).toBe(PLUGIN_API);
    expect(m.panels).toEqual([]);
    expect(m.actions).toEqual([]);
    expect(m.permissions.tasks).toBe(false);
  });

  it("ids follow the spec's pattern", () => {
    expect(PLUGIN_ID.test("on-this-day")).toBe(true);
    expect(PLUGIN_ID.test("On")).toBe(false);
    expect(PLUGIN_ID.test("-x")).toBe(false);
    expect(() => parsePluginManifest(manifest({ id: "../x" }))).toThrow();
  });

  it("refuses unknown keys (a typo is never silently ignored)", () => {
    expect(() => parsePluginManifest(manifest({ permisions: {} }))).toThrow(/permisions/);
  });

  it("refuses a scoped collection and an agent-writable one (Decision 2)", () => {
    const data = (c: object) => manifest({ data: { q: { scoped: false, key: "k", agent: "read", schema: { type: "object", properties: { k: { type: "string" } }, required: ["k"] }, ...c } } });
    expect(() => parsePluginManifest(data({}))).not.toThrow();
    expect(() => parsePluginManifest(data({ scoped: true }))).toThrow();
    expect(() => parsePluginManifest(data({ agent: "write" }))).toThrow();
  });

  it("refuses a collection schema that isn't an object or leaves the allowlist", () => {
    const data = (schema: object) => manifest({ data: { q: { key: "k", agent: "none", schema } } });
    expect(() => parsePluginManifest(data({ type: "string" }))).toThrow(/object/);
    expect(() => parsePluginManifest(data({ type: "object", properties: { k: { type: "string", pattern: "^a" } } }))).toThrow(/pattern/);
  });

  it("refuses duplicate ids", () => {
    expect(() => parsePluginManifest(manifest({ sources: [{ id: "a", ttl: 60 }, { id: "a", ttl: 60 }] }))).toThrow(/twice/);
    expect(() => parsePluginManifest(manifest({ permissions: { secrets: [{ id: "x", label: "X" }, { id: "x", label: "Y" }] } }))).toThrow(/twice/);
  });

  it("an exec pattern's * is only the last token, the command is a bare name and no secret goes into args", () => {
    expect(() => parsePluginManifest(manifest({ permissions: { exec: [{ cmd: "gh", args: ["*", "api"] }] } }))).toThrow(/last/);
    expect(() => parsePluginManifest(manifest({ permissions: { exec: [{ cmd: "/bin/sh", args: [] }] } }))).toThrow();
    expect(() => parsePluginManifest(manifest({ permissions: { exec: [{ cmd: "gh", args: ["{{secret:jira}}"] }] } }))).toThrow(/Secrets/);
  });

  it("actions need permissions.tasks", () => {
    const action = { id: "triage", label: "Triage", tier: "light", prompt: "Look at {{key}}." };
    expect(() => parsePluginManifest(manifest({ actions: [action] }))).toThrow(/tasks/);
  });

  it("repeats the core's tiers", () => {
    expect(PLUGIN_TIERS).toEqual(TIERS);
  });
});

describe("JSON Schema allowlist (Decision 3, B11)", () => {
  it.each([
    [{ type: "string", pattern: "^(a+)+$" }, "pattern"],
    [{ type: "object", patternProperties: { x: {} } }, "patternProperties"],
    [{ type: "string", format: "email" }, "format"],
    [{ $ref: "#/$defs/x" }, "\\$ref"],
    [{ not: { type: "string" } }, "not"],
    [{ type: "object", additionalProperties: { type: "string" } }, "additionalProperties"],
    [{ type: "object", properties: { a: { type: "string", pattern: "x" } } }, "pattern"],
    [{ type: "array", items: { type: "string", format: "uri" } }, "format"],
    [{ anyOf: [{ type: "string" }, { $ref: "#" }] }, "\\$ref"],
    [{ type: "regex" }, "type"],
    [{ type: "string", properties: { a: { type: "string" } } }, "object"],
    [{ type: "object", properties: { a: { type: "string" } }, required: ["b"] }, "required"],
  ])("refuses %j", (schema, word) => {
    expect(checkSchemaSubset(schema)).toMatch(new RegExp(word));
    expect(() => jsonSchemaToZod(schema)).toThrow();
  });

  // A node with no type would go to z.fromJSONSchema as "any value", nested objects and their keys included.
  const untyped: [string, unknown][] = [
    ["an empty node", {}],
    ["an array with no items", { type: "array" }],
    ["a list of types with array and no items", { type: ["array", "null"] }],
    ["an untyped anyOf branch", { anyOf: [{}] }],
    ["annotations only", { title: "x", default: 1 }],
  ];
  const nested = (node: unknown): [string, unknown][] => [
    ["at the top", node],
    ["in properties", { type: "object", properties: { a: node } }],
    ["in items", { type: "array", items: node }],
    ["in anyOf", { anyOf: [{ type: "string" }, node] }],
  ];
  it.each(untyped.flatMap(([what, node]) => nested(node).map(([where, s]) => [`${what} ${where}`, s] as const)))("refuses %s", (_, schema) => {
    expect(checkSchemaSubset(schema)).toMatch(/type|items/);
    expect(() => jsonSchemaToZod(schema)).toThrow();
  });

  it("a node typed by enum, const or anyOf alone is accepted", () => {
    expect(jsonSchemaToZod({ enum: ["a", 1, null] }).safeParse(1).success).toBe(true);
    expect(jsonSchemaToZod({ const: "x" }).safeParse("y").success).toBe(false);
    expect(jsonSchemaToZod({ anyOf: [{ type: "string" }, { const: 1 }] }).safeParse(1).success).toBe(true);
  });

  it.each([
    [{ type: "string", maxLength: "3" }, "maxLength"],
    [{ type: "string", minLength: -1 }, "minLength"],
    [{ type: "string", minLength: 1.5 }, "minLength"],
    [{ type: "array", items: { type: "string" }, maxItems: "1" }, "maxItems"],
    [{ type: "array", items: { type: "string" }, minItems: -2 }, "minItems"],
    [{ type: "number", minimum: "0" }, "minimum"],
    [{ type: "number", maximum: null }, "maximum"],
    [{ type: "number", exclusiveMinimum: true }, "exclusiveMinimum"],
    [{ type: "number", exclusiveMaximum: "1" }, "exclusiveMaximum"],
    [{ type: "number", multipleOf: 0 }, "multipleOf"],
    [{ type: "number", multipleOf: -2 }, "multipleOf"],
    [{ type: "string", enum: "abc" }, "enum"],
    [{ type: "string", enum: [] }, "enum"],
    [{ enum: [{ a: 1 }] }, "enum"],
    [{ const: { a: 1 } }, "const"],
    [{ type: "array", items: { type: "string" }, uniqueItems: "yes" }, "uniqueItems"],
    [{ type: "string", title: 3 }, "title"],
    [{ type: "string", description: [] }, "description"],
    [{ $schema: "http://json-schema.org/draft-04/schema#", type: "number", exclusiveMinimum: true }, "\\$schema"],
    [{ $schema: 1, type: "string" }, "\\$schema"],
    [{ type: "object", properties: { a: { $schema: "https://json-schema.org/draft/2020-12/schema", type: "string" } } }, "\\$schema"],
    [{ type: "array", items: { $schema: "http://json-schema.org/draft-07/schema#", type: "string" } }, "\\$schema"],
  ])("refuses a bad keyword value in %j", (schema, word) => {
    expect(checkSchemaSubset(schema)).toMatch(new RegExp(word));
    expect(() => jsonSchemaToZod(schema)).toThrow(new RegExp(word));
    expect(() => parsePluginManifest(manifest({ settings: { fields: { f: { schema, control: "text", label: "F" } } } }))).toThrow(z.ZodError);
  });

  it("takes $schema at the top for draft 2020-12 and draft-07", () => {
    for (const uri of ["https://json-schema.org/draft/2020-12/schema", "http://json-schema.org/draft-07/schema#", "http://json-schema.org/draft-07/schema"]) {
      expect(checkSchemaSubset({ $schema: uri, type: "number", exclusiveMinimum: 0 })).toBeNull();
      expect(jsonSchemaToZod({ $schema: uri, type: "number", exclusiveMinimum: 0 }).safeParse(0).success).toBe(false);
    }
  });

  it.each(["__proto__", "constructor", "prototype"])("refuses %s as a property name, and in required", (name) => {
    const props = JSON.parse(`{"${name}": {"type": "string"}}`);
    expect(checkSchemaSubset({ type: "object", properties: props })).toMatch(new RegExp(name));
    expect(checkSchemaSubset({ type: "object", properties: { a: { type: "object", properties: props } } })).toMatch(new RegExp(name));
    expect(checkSchemaSubset({ type: "object", properties: props, required: [name] })).toMatch(new RegExp(name));
  });

  it("refuses depth over 8 and more than 200 nodes", () => {
    let deep: object = { type: "string" };
    for (let i = 0; i < 9; i++) deep = { type: "array", items: deep };
    expect(checkSchemaSubset(deep)).toMatch(/deep/);
    const wide = { type: "object", properties: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}`, { type: "string" }])) };
    expect(checkSchemaSubset(wide)).toMatch(/large/);
  });

  it("converts to zod that accepts and refuses like the JSON Schema", () => {
    const s = jsonSchemaToZod({ type: "object", properties: { n: { type: "integer", minimum: 1 }, t: { type: "string", enum: ["a", "b"] } }, required: ["n"] });
    expect(s).toBeInstanceOf(z.ZodObject);
    expect(s.safeParse({ n: 2, t: "a" }).success).toBe(true);
    expect(s.safeParse({ n: 0 }).success).toBe(false);
    expect(s.safeParse({ n: 1.5 }).success).toBe(false);
    expect(s.safeParse({ n: 1, t: "c" }).success).toBe(false);
    expect(s.safeParse({ t: "a" }).success).toBe(false);
    // Unknown keys are dropped, as a harness collection's zod object does (data.md).
    expect(s.parse({ n: 1, extra: true })).toEqual({ n: 1 });
  });

  it("drops unknown keys at every level, through items and anyOf too (spike S8)", () => {
    const s = jsonSchemaToZod({
      type: "object",
      properties: {
        n: { type: "object", properties: { c: { type: "string" } } },
        list: { type: "array", items: { type: "object", properties: { d: { type: "number" } }, required: ["d"] } },
        either: { anyOf: [{ type: "object", properties: { e: { type: "boolean" } }, required: ["e"] }, { type: "null" }] },
      },
    });
    expect(s.parse({ n: { c: "y", deep: 1 }, list: [{ d: 1, x: 2 }], either: { e: true, y: 3 }, extra: 1 })).toEqual({ n: { c: "y" }, list: [{ d: 1 }], either: { e: true } });
    expect(s.parse({ either: null })).toEqual({ either: null });
    expect(s.safeParse({ list: [{}] }).success).toBe(false);
  });

  it("additionalProperties false refuses unknown keys, true keeps them", () => {
    const strict = jsonSchemaToZod({ type: "object", properties: { a: { type: "string" } }, additionalProperties: false });
    expect(strict.safeParse({ a: "x", b: 1 }).success).toBe(false);
    const loose = jsonSchemaToZod({ type: "object", properties: { a: { type: "string" } }, additionalProperties: true });
    expect(loose.parse({ a: "x", b: 1 })).toEqual({ a: "x", b: 1 });
  });

  it("takes a list of types, with an object among them", () => {
    const s = jsonSchemaToZod({ type: ["object", "null"], properties: { a: { type: "string" } }, required: ["a"] });
    expect(s.parse(null)).toBeNull();
    expect(s.parse({ a: "x", b: 1 })).toEqual({ a: "x" });
    expect(s.safeParse({}).success).toBe(false);
    expect(s.safeParse("x").success).toBe(false);
    const leaf = jsonSchemaToZod({ type: ["string", "number"] });
    expect(leaf.safeParse(1).success).toBe(true);
    expect(leaf.safeParse(true).success).toBe(false);
  });

  it("keeps array bounds, uniqueItems and defaults on built nodes", () => {
    const s = jsonSchemaToZod({ type: "array", items: { type: "object", properties: { k: { type: "string" } } }, minItems: 1, maxItems: 2, uniqueItems: true });
    expect(s.safeParse([]).success).toBe(false);
    expect(s.safeParse([{ k: "a" }, { k: "b" }, { k: "c" }]).success).toBe(false);
    expect(s.safeParse([{ k: "a" }, { k: "a" }]).success).toBe(false);
    expect(s.safeParse([{ k: "a" }, { k: "b" }]).success).toBe(true);
    const d = jsonSchemaToZod({ type: "object", properties: { o: { type: "object", properties: { a: { type: "string" } }, default: { a: "x" } }, s: { type: "string", default: "hi" } } });
    expect(d.parse({})).toEqual({ o: { a: "x" }, s: "hi" });
  });

  it("an empty object schema takes any object and drops its keys", () => {
    expect(jsonSchemaToZod({ type: "object", properties: {} }).parse({ a: 1 })).toEqual({});
    expect(jsonSchemaToZod({ type: "object" }).parse({ a: 1 })).toEqual({});
  });
});

describe("collections and settings from plugin.json", () => {
  it("builds harness-model collections, app-wide", () => {
    const c = pluginCollections(parsePluginManifest(manifest()));
    expect(Object.keys(c)).toEqual(["queues"]);
    expect(c.queues.scoped).toBe(false);
    expect(c.queues.agent).toBe("read");
    expect(c.queues.schema).toBeInstanceOf(z.ZodObject);
    expect(c.queues.schema.safeParse({ key: "DOC-1", title: "x" }).success).toBe(true);
    expect(c.queues.schema.safeParse({ key: "DOC-1" }).success).toBe(false);
  });

  it("a key that isn't a plain string or number is refused like a harness's", () => {
    const m = manifest({ data: { q: { scoped: false, key: "k", agent: "none", schema: { type: "object", properties: { k: { type: "string", enum: ["a"] } }, required: ["k"] } } } });
    expect(() => pluginCollections(parsePluginManifest(m))).toThrow(/key/);
    const optional = manifest({ data: { q: { key: "k", agent: "none", schema: { type: "object", properties: { k: { type: "string" } } } } } });
    expect(() => pluginCollections(parsePluginManifest(optional))).toThrow(/key/);
  });

  it("settings go through the harness settings checks", () => {
    const s = pluginSettings(parsePluginManifest(manifest()))!;
    expect(s.tab).toBe("On-call");
    expect(s.fields.team.control).toBe("segmented");
    expect(s.fields.team.schema.safeParse("web").success).toBe(true);
    expect(s.fields.team.schema.safeParse("x").success).toBe(false);
    const bad = manifest({ settings: { tab: "X", fields: { team: { schema: { type: "string" }, default: 3, control: "text", label: "T" } } } });
    expect(() => pluginSettings(parsePluginManifest(bad))).toThrow();
    const control = manifest({ settings: { fields: { on: { schema: { type: "boolean" }, default: false, control: "slider", label: "On" } } } });
    expect(() => pluginSettings(parsePluginManifest(control))).toThrow();
  });

  it("a settings section's id is a local id and its label is short text", () => {
    const fields = { on: { schema: { type: "boolean" }, default: false, control: "toggle", label: "On" } };
    expect(() => parsePluginManifest(manifest({ settings: { sections: [{ id: "main", label: "Main" }], fields } }))).not.toThrow();
    for (const section of [{ id: "Bad Id", label: "Main" }, { id: "", label: "Main" }, { id: "main", label: "" }, { id: "main", label: "x".repeat(61) }]) {
      expect(() => parsePluginManifest(manifest({ settings: { sections: [section], fields } }))).toThrow();
    }
  });

  it("a settings tab defaults to the plugin's name", () => {
    const m = manifest({ settings: { fields: { on: { schema: { type: "boolean" }, default: false, control: "toggle", label: "On" } } } });
    expect(pluginSettings(parsePluginManifest(m))!.tab).toBe("On-call");
  });

  it("no settings: undefined", () => {
    expect(pluginSettings(parsePluginManifest(manifest({ settings: undefined })))).toBeUndefined();
  });
});
