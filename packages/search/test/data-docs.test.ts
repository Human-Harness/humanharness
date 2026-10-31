import { describe, expect, it } from "vitest";
import { type DataSource, INDEX_KINDS, KINDS, LiveIndex, dataDocs, recordRows } from "../src";

const people = { key: "id", single: false, search: { title: "name", text: ["bio", "tags"] } };
const src = (o: Partial<DataSource> = {}): DataSource => ({ id: "harness:_app/people", owner: "harness", collection: "people", folder: "_app", stamp: "1:2", ...o });

describe("data records (search spec D4)", () => {
  it("adds a data kind to the index; KINDS stays plan 1's", () => {
    expect(KINDS).toEqual(["task", "note", "file"]);
    expect(INDEX_KINDS).toEqual(["task", "note", "file", "data"]);
  });

  it("one row per record: the declared title and text, the key when the title is empty, recency from data-meta", () => {
    const rows = recordRows([{ id: "a", name: "Ana", bio: "Physics teacher", tags: ["lab", "quiz"] }, { id: 7, name: "" }, { name: "no key" }], people, { a: "2026-10-30T10:00:00.000Z" });
    expect(rows).toEqual([
      { key: "a", title: "Ana", text: "Physics teacher\nlab, quiz", at: Date.parse("2026-10-30T10:00:00.000Z") },
      { key: 7, title: "7", text: "", at: 0 },
    ]);
  });

  it("a single collection's record has no key", () => {
    expect(recordRows([{ name: "Me" }], { single: true, search: { title: "name" } })).toEqual([{ key: null, title: "Me", text: "", at: 0 }]);
  });

  it("token-shaped lines never enter the text; a token-shaped title falls back to the key (§8.2)", () => {
    const token = `ghp_${"a1B2".repeat(9)}`;
    const [r] = recordRows([{ id: "k", name: token, bio: `ok line\n${token}` }], people);
    expect(r.title).toBe("k");
    expect(r.text).toContain("ok line");
    expect(r.text).not.toContain("ghp_");
  });

  it("scopes: a scoped collection's folder, else the app; main without scopes; plugin data is app-wide", () => {
    const rows = recordRows([{ id: "a", name: "Ana" }], people);
    expect(dataDocs(src(), rows, true)[0].scope).toBe("_app");
    expect(dataDocs(src({ id: "harness:physics/people", folder: "physics" }), rows, true)[0].scope).toBe("physics");
    expect(dataDocs(src({ id: "harness:physics/people", folder: "physics" }), rows, false)[0].scope).toBe("main");
    expect(dataDocs(src({ id: "plugin:jira/issues", owner: "plugin", plugin: "jira", pluginName: "Jira", panel: "main", collection: "issues" }), rows, true)[0]).toMatchObject({
      id: "data:plugin:jira/issues#a",
      kind: "data",
      scope: "_app",
      data: { source: "plugin:jira/issues", owner: "plugin", plugin: "jira", pluginName: "Jira", panel: "main", collection: "issues", key: "a" },
    });
  });

  it("is found by title and text; a hit carries where it opens; the text is never stored (§4.1)", () => {
    const index = LiveIndex.empty();
    index.upsert(dataDocs(src(), recordRows([{ id: "a", name: "Ana", bio: "Physics teacher" }], people), false));
    const [hit] = index.search("physics").hits;
    expect(hit).toMatchObject({ id: "data:harness:_app/people#a", kind: "data", title: "Ana", data: { collection: "people", key: "a", folder: "_app" } });
    expect(index.stored(hit.id)).not.toHaveProperty("text");
    expect(index.toJSON()).not.toContain("Physics teacher");
  });
});
