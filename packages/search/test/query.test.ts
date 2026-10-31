import { describe, expect, it } from "vitest";
import { LiveIndex, type SearchDoc } from "../src";

const NOW = Date.parse("2026-10-30T12:00:00.000Z");
const DAY = 24 * 3600 * 1000;
const doc = (id: string, o: Partial<SearchDoc> = {}): SearchDoc => ({ id, kind: "file", scope: "main", title: id, path: "", text: "", at: 0, root: "folder", ...o });

function indexOf(docs: SearchDoc[]): LiveIndex {
  const ix = LiveIndex.empty();
  ix.upsert(docs);
  return ix;
}
const ids = (ix: LiveIndex, q: string, o = {}) => ix.search(q, { now: NOW, ...o }).hits.map((h) => h.id);

describe("LiveIndex.search (§5.3)", () => {
  it("folds accents and matches prefixes and fuzzy terms of 4+ characters", () => {
    const ix = indexOf([doc("a", { text: "La Fracción decimal" }), doc("b", { text: "configuration" })]);
    expect(ids(ix, "fraccion")).toEqual(["a"]);
    expect(ids(ix, "conf")).toEqual(["b"]);
    expect(ids(ix, "configuratoin")).toEqual(["b"]);
    expect(ids(ix, "cnf")).toEqual([]);
  });

  it("needs every word, then falls back to any word and says so", () => {
    const ix = indexOf([doc("a", { text: "context window" }), doc("b", { text: "context only" })]);
    expect(ix.search("context window", { now: NOW })).toMatchObject({ partial: false });
    expect(ids(ix, "context window")).toEqual(["a"]);
    const r = ix.search("context zebra", { now: NOW });
    expect(r.partial).toBe(true);
    expect(r.hits.map((h) => h.id).sort()).toEqual(["a", "b"]);
  });

  it("boosts a title match over a text match, and a recent one over an old one", () => {
    // Separate indexes: BM25's per-field rarity would otherwise let one text match beat a title many documents share.
    expect(ids(indexOf([doc("intext", { title: "x", text: "engines" }), doc("intitle", { title: "engines" })]), "engines")).toEqual(["intitle", "intext"]);
    expect(ids(indexOf([doc("old", { title: "engines", at: NOW - 30 * DAY }), doc("new", { title: "engines", at: NOW - DAY })]), "engines")).toEqual(["new", "old"]);
  });

  it("filters by scope, kind and reference folders", () => {
    const ix = indexOf([doc("p", { scope: "physics", title: "plan" }), doc("c", { scope: "chem", title: "plan" }), doc("a", { scope: "_app", title: "plan" }), doc("r", { scope: "_app", title: "plan", root: "ref:docs" }), doc("n", { scope: "_app", title: "plan", kind: "note" })]);
    expect(ids(ix, "plan", { scopes: ["physics", "_app"] }).sort()).toEqual(["a", "n", "p", "r"]);
    expect(ids(ix, "plan", { kinds: ["note"] })).toEqual(["n"]);
    expect(ids(ix, "plan", { references: false })).not.toContain("r");
  });

  it("gives the stored fields and the matched terms, never the text", () => {
    const ix = indexOf([doc("a", { title: "Guide", path: "docs/guide.md", text: "secret-free body" })]);
    const [hit] = ix.search("guide", { now: NOW }).hits;
    expect(hit).toMatchObject({ id: "a", title: "Guide", path: "docs/guide.md", kind: "file" });
    expect(hit.terms).toContain("guide");
    expect("text" in hit).toBe(false);
  });

  it("replaces and removes documents", () => {
    const ix = indexOf([doc("a", { title: "old" })]);
    ix.upsert([doc("a", { title: "new" })]);
    expect(ids(ix, "old")).toEqual([]);
    expect(ids(ix, "new")).toEqual(["a"]);
    ix.remove(["a", "missing"]);
    expect(ix.size).toBe(0);
  });

  it("round-trips through JSON; a bad snapshot is null", () => {
    const ix = indexOf([doc("a", { title: "guide" })]);
    const back = LiveIndex.fromJSON(ix.toJSON());
    expect(back && ids(back, "guide")).toEqual(["a"]);
    expect(back?.stored("a")).toMatchObject({ title: "guide" });
    expect(LiveIndex.fromJSON("{bad")).toBeNull();
  });

  it("an empty query finds nothing; status is kept as set", () => {
    const ix = indexOf([doc("a")]);
    expect(ix.search("   ", { now: NOW }).hits).toEqual([]);
    expect(ix.status()).toEqual({ state: "empty", done: 0, total: 0 });
    ix.setStatus({ state: "ready", done: 1, total: 1 });
    expect(ix.status().state).toBe("ready");
  });
});
