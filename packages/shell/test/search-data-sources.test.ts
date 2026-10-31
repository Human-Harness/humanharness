import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectionSchema, z } from "@humanharness/harness-sdk";
import { APP_SCOPE, DataStore, dataMetaFile } from "@humanharness/workspace";
import { harnessRows, harnessSources } from "../src/main/search/data-sources";

const collections = {
  people: collectionSchema.parse({ scoped: false, key: "id", agent: "none", schema: z.object({ id: z.string(), name: z.string(), bio: z.string() }), search: { title: "name", text: "bio" } }),
  marks: collectionSchema.parse({ scoped: true, key: "id", agent: "read", schema: z.object({ id: z.string(), what: z.string() }), search: { title: "what" } }),
  plain: collectionSchema.parse({ scoped: false, key: "id", agent: "read", schema: z.object({ id: z.string() }) }),
};
let base: string;
beforeEach(async () => {
  base = await fs.mkdtemp(path.join(os.tmpdir(), "hh-search-sources-"));
});
afterEach(() => fs.rm(base, { recursive: true, force: true }));

describe("harness data sources (search spec D4)", () => {
  it("one per searchable collection and folder: app-wide in _app, scoped in each open-able scope, main without scopes", async () => {
    const scoped = await harnessSources({ base, collections, scoped: true, scopes: async () => ["physics", "maths"] });
    expect(scoped.map((s) => s.id)).toEqual(["harness:_app/people", "harness:physics/marks", "harness:maths/marks"]);
    expect(scoped[0]).toEqual({ id: "harness:_app/people", owner: "harness", collection: "people", folder: "_app", stamp: expect.stringMatching(/^none\|none#/) });
    const plain = await harnessSources({ base, collections, scoped: false, scopes: async () => [] });
    expect(plain.map((s) => s.id)).toEqual(["harness:_app/people", "harness:main/marks"]);
  });

  it("the scopes aren't asked for when no searchable collection is scoped", async () => {
    let asked = 0;
    const own = await harnessSources({ base, collections: { people: collections.people }, scoped: true, scopes: async () => (asked++, ["physics"]) });
    expect(own.map((s) => s.id)).toEqual(["harness:_app/people"]);
    expect(asked).toBe(0);
  });

  it("the stamp changes with a write; the rows are the declared fields", async () => {
    const store = new DataStore(base, collections);
    const deps = { base, collections, scoped: false, scopes: async () => [] };
    const before = (await harnessSources(deps))[0].stamp;
    await store.put("people", { id: "a", name: "Ana", bio: "Physics teacher" }, { who: "app", scope: APP_SCOPE });
    const [people] = await harnessSources(deps);
    expect(people.stamp).not.toBe(before);
    expect(await harnessRows(store, collections, people)).toEqual([{ key: "a", title: "Ana", text: "Physics teacher", at: expect.any(Number) }]);
    expect(await harnessRows(store, collections, { ...people, collection: "plain" })).toEqual([]);
    expect(await harnessRows(store, collections, { ...people, collection: "missing" })).toEqual([]);
  });

  it("a write to the meta file alone changes the stamp (the store writes the records, then when each changed)", async () => {
    const store = new DataStore(base, collections);
    const deps = { base, collections, scoped: false, scopes: async () => [] };
    await store.put("people", { id: "a", name: "Ana", bio: "Physics teacher" }, { who: "app", scope: APP_SCOPE });
    const before = (await harnessSources(deps))[0].stamp;
    const meta = dataMetaFile(base, APP_SCOPE, "people");
    await fs.writeFile(meta, `${await fs.readFile(meta, "utf8")}\n`);
    expect((await harnessSources(deps))[0].stamp).not.toBe(before);
  });

  it("a declaration that changes changes the stamp, with the same files", async () => {
    const deps = { base, collections, scoped: false, scopes: async () => [] };
    const before = (await harnessSources(deps))[0].stamp;
    const people = collectionSchema.parse({ ...collections.people, search: { title: "bio" } });
    const after = (await harnessSources({ ...deps, collections: { ...collections, people } }))[0].stamp;
    expect(after).not.toBe(before);
    expect(after.split("#")[0]).toBe(before.split("#")[0]);
  });

  it("a record whose key is token-shaped gives no row (§8.2)", async () => {
    const store = new DataStore(base, collections);
    const token = `ghp_${"a".repeat(36)}`;
    await store.put("people", { id: token, name: "Leaked", bio: "x" }, { who: "app", scope: APP_SCOPE });
    await store.put("people", { id: "b", name: "Bea", bio: "Maths" }, { who: "app", scope: APP_SCOPE });
    const [people] = await harnessSources({ base, collections, scoped: false, scopes: async () => [] });
    expect((await harnessRows(store, collections, people)).map((r) => r.key)).toEqual(["b"]);
  });
});
