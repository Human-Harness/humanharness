import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COLLECTION_NAME, dataSchema, defineHarness, loadHarness, z } from "../src";

const base = {
  id: "test",
  name: "Test",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Test" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder" as const, exec: false, web: false },
  blocks: {},
  author: "Someone",
};
const concept = z.object({ id: z.string(), name: z.string(), state: z.enum(["seen", "mastered"]) });

describe("data collections", () => {
  it("parses a collection with its defaults", () => {
    const data = dataSchema.parse({ concepts: { scoped: true, key: "id", schema: concept, agent: "write" } });
    expect(data.concepts).toMatchObject({ scoped: true, single: false, key: "id", agent: "write", context: false });
    expect(data.concepts.schema).toBe(concept);
  });

  it("is empty by default, so a harness without data is unchanged (spec D2)", () => {
    expect(defineHarness(base).data).toEqual({});
  });

  it("takes a single record with no key, a context with fields, and rules", () => {
    const rules = () => true as const;
    const data = dataSchema.parse({
      profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read", context: { fields: "all", tokens: 300 } },
      concepts: { scoped: true, key: "id", schema: concept, agent: "write", context: { fields: ["id", "state"], tokens: 400 }, rules },
    });
    expect(data.profile.context).toEqual({ fields: "all", tokens: 300 });
    expect(data.concepts.rules).toBe(rules);
  });

  it("refuses what can't work", () => {
    const bad = (collection: Record<string, unknown>, name = "concepts") => () => defineHarness({ ...base, data: { [name]: { scoped: true, schema: concept, agent: "write", ...collection } } as never });
    expect(bad({})).toThrow(/needs a key/);
    expect(bad({ key: "nope" })).toThrow(/not a field/);
    expect(bad({ key: "id", agent: "none", context: { fields: ["id"], tokens: 100 } })).toThrow(/hidden from the agent/);
    expect(bad({ key: "id", context: { fields: ["nope"], tokens: 100 } })).toThrow(/not a field/);
    expect(bad({ key: "id", context: { fields: ["id"], tokens: 10 } })).toThrow();
    expect(bad({ key: "id", schema: z.string() })).toThrow(/z\.object/);
    expect(bad({ key: "id" }, "settings")).toThrow(/reserved/);
    expect(bad({ key: "id" }, "Bad-Name")).toThrow();
    expect(COLLECTION_NAME.test("flash_cards")).toBe(true);
  });

  it("takes a required string or number key, and refuses any other key type", () => {
    const withKey = (id: z.ZodType) => () => dataSchema.parse({ items: { scoped: true, key: "id", schema: z.object({ id }), agent: "write" } });
    expect(withKey(z.string())).not.toThrow();
    expect(withKey(z.number().int())).not.toThrow();
    expect(withKey(z.array(z.string()))).toThrow(/must be a required string or number/);
    expect(withKey(z.boolean())).toThrow(/must be a required string or number/);
    expect(withKey(z.string().optional())).toThrow(/must be a required string or number/);
    expect(withKey(z.string().nullable())).toThrow(/must be a required string or number/);
    expect(withKey(z.number().default(1))).toThrow(/must be a required string or number/);
  });

  it("loads the study fixture's collections", async () => {
    const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/data-harness/harness.config.ts");
    const h = await loadHarness(fixture);
    expect(Object.keys(h.data)).toEqual(["concepts", "flashcards", "profile", "secrets"]);
    expect(h.data.profile.single).toBe(true);
  });
});
