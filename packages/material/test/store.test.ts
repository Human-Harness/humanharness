import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { type Fragment, MaterialStore, type SourceEntry, parseFragment, renderFragment, sourceSlug } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-material-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let base: string;
let store: MaterialStore;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(root, "b-"));
  store = new MaterialStore(base, "fractions");
});

const frag = (id: string, extra: Partial<Fragment["meta"]> = {}): Fragment => ({
  meta: {
    id,
    source: "ch2.pdf",
    location: "p.4–5",
    path: "Fractions › Equivalent",
    summary: "Gets 6/15 from 2/5.",
    keywords: ["equivalent", "numerator"],
    tokens: 240,
    items: [],
    checks: "ok",
    validated: "not-reviewed",
    ...extra,
  },
  md: "## Example 2\n\nMultiply both by 3.",
});
const entry = (id: string, extra: Partial<SourceEntry> = {}): SourceEntry => ({
  id,
  scope: "fractions",
  path: `${id}.pdf`,
  hash: "h",
  type: "pdf",
  family: "pdf",
  pages: 2,
  sizeBytes: 10,
  skippedPages: [],
  status: "ready",
  issues: [],
  fixes: [],
  estimate: 0,
  used: 0,
  fragments: [],
  addedAt: "2026-10-27T10:00:00.000Z",
  ...extra,
});

describe("fragment files (material spec §4.1)", () => {
  it("round-trips the front matter", () => {
    const f = frag("ch2-007", { kind: "example", checks: ["size", "noise"], items: ["equivalent-fractions"] });
    const text = renderFragment(f);
    expect(text.startsWith("---\nid: ch2-007\nsource: \"ch2.pdf\"\n")).toBe(true);
    expect(parseFragment(text)).toEqual(f);
  });

  it("a hand-broken file reads as null", () => {
    expect(parseFragment("no front matter")).toBeNull();
  });
});

describe("MaterialStore", () => {
  it("registry: empty at first, atomic updates, a broken file set aside", async () => {
    expect(await store.sources()).toEqual([]);
    await store.update((list) => [...list, entry("ch2")]);
    expect((await store.sources()).map((s) => s.id)).toEqual(["ch2"]);
    const file = path.join(base, ".harness", "material", "fractions", "sources.json");
    fs.writeFileSync(file, "{broken");
    expect(await store.sources()).toEqual([]);
    expect(fs.readdirSync(path.dirname(file)).some((f) => f.startsWith("sources.json.corrupt-"))).toBe(true);
  });

  it("writes a source's fragments, drops the ones it no longer has, and keeps a program version once", async () => {
    await store.update(() => [entry("ch2")]);
    await store.writeFragments("ch2", [frag("ch2-001"), frag("ch2-002")]);
    expect((await store.sources())[0].fragments).toEqual(["ch2-001", "ch2-002"]);
    expect((await store.readFragment("ch2-002"))?.meta.id).toBe("ch2-002");
    await store.keepOriginal("ch2-001");
    await store.writeFragments("ch2", [frag("ch2-001", { validated: "repaired" })]);
    expect(await store.readFragment("ch2-002")).toBeNull();
    expect(fs.existsSync(path.join(base, ".harness", "material", "fractions", "fragments", ".orig", "ch2-001.md"))).toBe(true);
    expect((await store.readOriginalVersion("ch2-001"))?.meta.validated).toBe("not-reviewed");
  });

  it("refuses ids that aren't fragment ids", async () => {
    expect(await store.readFragment("../../x")).toBeNull();
  });

  it("the index lists the fragments of usable sources, without pending ones", async () => {
    await store.update(() => [entry("ch2", { status: "ready" }), entry("old", { status: "removed" })]);
    await store.writeFragments("ch2", [frag("ch2-001", { kind: "example" }), frag("ch2-002", { validated: "pending" })]);
    await store.writeIndex();
    const index = fs.readFileSync(path.join(base, ".harness", "material", "fractions", "index.md"), "utf8");
    expect(index).toContain("| id | where | path | kind | summary | items |");
    expect(index).toContain("| ch2-001 | ch2.pdf, p.4–5 | Fractions › Equivalent | example | Gets 6/15 from 2/5. |  |");
    expect(index).not.toContain("ch2-002");
    expect((await store.indexRows()).map((r) => r.id)).toEqual(["ch2-001"]);
  });

  it("originals: kept under material/<scope>, a name in use gets a number", async () => {
    expect(await store.addOriginal("Ch 2.pdf", Buffer.from("a"))).toBe("Ch 2.pdf");
    expect(await store.addOriginal("Ch 2.pdf", Buffer.from("b"))).toBe("Ch 2 (2).pdf");
    expect(fs.readFileSync(path.join(base, "material", "fractions", "Ch 2 (2).pdf"), "utf8")).toBe("b");
  });

  it("the sheet, the conflicts and the grounding mode", async () => {
    expect(await store.sheet()).toBe("");
    await store.writeSheet("## Terms\n\n- fraction: a part");
    expect(await store.sheet()).toContain("fraction");
    await store.appendConflict({ fragment: "ch2-001", claim: "x", resolution: "followed the material" });
    expect(fs.readFileSync(path.join(base, ".harness", "material", "fractions", "conflicts.md"), "utf8")).toContain("ch2-001");
    expect(await store.grounding()).toBeNull();
    await store.setGrounding("strict");
    expect(await store.grounding()).toBe("strict");
  });

  it("names and ids from outside stay inside the scope's folders", async () => {
    expect(await store.addOriginal("../../evil.pdf", Buffer.from("x"))).toBe("evil.pdf");
    expect(await store.addOriginal("..", Buffer.from("x"))).toBe("file");
    expect(store.originalPath("../x.pdf")).toBeNull();
    expect(store.originalPath("evil.pdf")).toBe(path.join(base, "material", "fractions", "evil.pdf"));
    await expect(store.appendConflict({ fragment: "x\n- forged", claim: "c", resolution: "r" })).rejects.toThrow();
  });

  it("a hand-edited registry entry without a fragment list loads no fragments", async () => {
    await store.update(() => [entry("ch2")]);
    await store.writeFragments("ch2", [frag("ch2-001")]);
    const file = path.join(base, ".harness", "material", "fractions", "sources.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf8"));
    delete raw.sources[0].fragments;
    fs.writeFileSync(file, JSON.stringify(raw));
    expect(await store.indexRows()).toEqual([]);
  });

  it("source ids are slugs of the name, numbered when taken", () => {
    expect(sourceSlug("Fracciones – Cap 2.pdf", new Set())).toBe("fracciones-cap-2");
    expect(sourceSlug("Fracciones – Cap 2.pdf", new Set(["fracciones-cap-2"]))).toBe("fracciones-cap-2-2");
    expect(sourceSlug("???.pdf", new Set())).toBe("source");
  });
});
