import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fragment, MaterialSearch, MaterialStore, type SourceEntry, flagFragment, materialSection, readForTask } from "../src";

let base: string;
let store: MaterialStore;
const frag = (n: number, md: string, extra: Partial<Fragment["meta"]> = {}): Fragment => ({
  meta: { id: `ch2-00${n}`, source: "ch2.pdf", location: `p.${n}`, path: `Fractions › Part ${n}`, summary: `Summary ${n}.`, keywords: [], tokens: 100, items: [], checks: "ok", validated: "not-reviewed", ...extra },
  md,
});
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 3, sizeBytes: 1, skippedPages: [], status: "ready", issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-use-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", [frag(1, "Equivalent fractions name the same amount."), frag(2, "Simplify by dividing both terms.", { keywords: ["simplificar"] }), frag(3, "Mixed numbers.")]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("MaterialSearch", () => {
  it("finds by words, keywords and prefixes; ranks; caps", async () => {
    const s = MaterialSearch.of(await store.fragments());
    expect(s.search("equivalent").map((h) => h.id)).toEqual(["ch2-001"]);
    expect(s.search("simplificar").map((h) => h.id)).toEqual(["ch2-002"]);
    expect(s.search("simpl")[0].id).toBe("ch2-002");
    expect(s.search("nothing here at all")).toEqual([]);
  });
});

describe("readForTask and flagFragment", () => {
  it("reads a fragment with where it comes from; counts the use", async () => {
    expect(await readForTask(store, "ch2-002")).toBe("[[frag:ch2-002]] ch2.pdf, p.2 (Fractions › Part 2)\n\nSimplify by dividing both terms.");
    expect((await store.source("ch2"))?.used).toBe(1);
    expect(await readForTask(store, "ch2-009")).toBeNull();
    expect(await readForTask(store, "../x")).toBeNull();
  });

  it("a flag leaves the fragment out of the index and sends its source back to review", async () => {
    expect(await flagFragment(store, "ch2-001", "The table is broken")).toBe(true);
    expect((await store.readFragment("ch2-001"))?.meta.validated).toBe("pending");
    expect((await store.indexRows()).map((r) => r.id)).toEqual(["ch2-002", "ch2-003"]);
    expect(await store.source("ch2")).toMatchObject({ status: "validating", stage: "review", issues: ["Flagged in use: ch2-001: The table is broken"] });
    expect(await flagFragment(store, "nope-001", "x")).toBe(false);
  });
});

describe("materialSection (§9 Load)", () => {
  it("the grounding rule, how to fetch, the sheet, then index rows within the budget", async () => {
    const rows = await store.indexRows();
    const text = materialSection({ mode: "strict", sheet: "## Key terms\n- fraction", rows, budgetTokens: 600 });
    expect(text.startsWith("## Material\n\n")).toBe(true);
    expect(text).toContain("Answer from the material only");
    expect(text).toContain("material_read");
    expect(text).toContain("[[frag:<id>]]");
    expect(text).toContain("## Key terms");
    expect(text).toContain("| ch2-001 | ch2.pdf, p.1 | Fractions › Part 1 |  | Summary 1. |");
    // The budget counts the index table only (header and rows), not the rule or the sheet.
    const small = materialSection({ mode: "mixed", sheet: "", rows, budgetTokens: 40 });
    expect(small).toContain("Prefer the material");
    expect(small).toContain("| ch2-001 |");
    expect(small).not.toContain("| ch2-002 |");
    expect(small).toContain("2 more fragments: find them with `material_search`.");
  });

  it("nothing usable: no section", () => {
    expect(materialSection({ mode: "mixed", sheet: "", rows: [], budgetTokens: 600 })).toBe("");
  });
});
