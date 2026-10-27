import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fragment, LABEL_TOKENS, MaterialStore, REPAIR_MAX_WORD_DIFF, REVIEW_TOKENS, SHEET_TOKENS, STAGES, type SourceEntry, applyReview, asksOf, decide, wordDiff } from "../src";

let base: string;
let store: MaterialStore;
const f5: Fragment = { meta: { id: "ch2-005", source: "ch2.pdf", location: "p.5", path: "T", summary: "", keywords: [], tokens: 50, items: [], checks: ["table"], validated: "not-reviewed" }, md: "a b c\n1 2 3\n4 5 6" };
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 9, sizeBytes: 1, skippedPages: [], status: "validating", stage: "repair", repairs: [{ id: "ch2-005", issue: "Table lost its columns" }], issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
const job = { scope: "fractions", source: "ch2", stage: "repair" as const };
const ctx = { fragmentKinds: [], sheetSections: [], sheetMaxTokens: 800 };
const table = "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |";

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-repair-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", [f5]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("wordDiff", () => {
  it("counts changed words, ignoring Markdown marks and spacing", () => {
    expect(wordDiff("a b c\n1 2 3", "| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |")).toBe(0);
    expect(wordDiff("one two three four", "one two three five")).toBe(0.25);
    expect(wordDiff("", "")).toBe(0);
    expect(wordDiff("first\nsecond", "- first\n- second")).toBe(0);
  });

  it("a sign or a tilde is part of the word: a flipped sign is a change, and the repair is refused", async () => {
    expect(wordDiff("x = -3/4", "x = 3/4")).toBeGreaterThan(0);
    expect(wordDiff("about ~5 cm", "about 5 cm")).toBeGreaterThan(0);
    const words = Array.from({ length: 30 }, (_, i) => `w${i}`).join(" ");
    await store.writeFragments("ch2", [{ ...f5, md: `${words} -3/4` }]);
    await expect(STAGES.repair!.accept("material_repair", { id: "ch2-005", markdown: `${words} 3/4` }, { store, job, answers: [] })).rejects.toThrow("changes the words");
  });

  it("a deletion counts in full: 3% of the words gone is over the limit", () => {
    const all = Array.from({ length: 100 }, (_, i) => `w${i}`);
    expect(wordDiff(all.join(" "), all.slice(3).join(" "))).toBe(0.03);
    expect(wordDiff(all.join(" "), all.slice(3).join(" "))).toBeGreaterThan(REPAIR_MAX_WORD_DIFF);
  });
});

describe("the repair stage", () => {
  it("accepts a structure-only repair; keeps the program's version", async () => {
    const state = { store, job, answers: [] };
    expect(await STAGES.repair!.prompt(store, job, ctx)).toContain("Table lost its columns");
    expect(await STAGES.repair!.accept("material_repair", { id: "ch2-005", markdown: table }, state)).toBe("Saved.");
    expect(await STAGES.repair!.apply(store, job, state, ctx)).toBe(true);
    expect((await store.readFragment("ch2-005"))?.meta.validated).toBe("repaired");
    expect((await store.readFragment("ch2-005"))?.md).toBe(table);
    expect((await store.readOriginalVersion("ch2-005"))?.md).toBe("a b c\n1 2 3\n4 5 6");
    const s = await store.source("ch2");
    expect(s).toMatchObject({ stage: "label", fixes: ["Repaired ch2-005: Table lost its columns"] });
    expect(s?.repairs).toBeUndefined();
  });

  it("refuses a repair that changes words, and asks the person", async () => {
    const state = { store, job, answers: [] };
    await STAGES.repair!.prompt(store, job, ctx);
    await expect(STAGES.repair!.accept("material_repair", { id: "ch2-005", markdown: "x y z\n7 8 9\n4 5 6" }, state)).rejects.toThrow("changes the words");
    await STAGES.repair!.apply(store, job, state, ctx);
    expect((await store.source("ch2"))?.asks).toEqual([{ fragment: "ch2-005", question: expect.stringContaining("ch2-005"), choices: ["program", "drop"] }]);
    expect((await store.readFragment("ch2-005"))?.md).toBe(f5.md);
  });

  it("ignores repairs and questions whose fragment is gone, even with its file left behind", async () => {
    const gone: Fragment = { ...f5, meta: { ...f5.meta, id: "ch2-009" } };
    await store.writeFragment(gone);
    await store.patch("ch2", (s) => ({
      ...s,
      repairs: [{ id: "ch2-009", issue: "Merged away" }],
      asks: [{ fragment: "ch2-009", question: "?", choices: ["keep", "drop"] }, { question: "Use it?", choices: ["use", "remove"] }],
    }));
    const state = { store, job, answers: [] };
    expect(await STAGES.repair!.prompt(store, job, ctx)).toBeNull();
    await expect(STAGES.repair!.accept("material_repair", { id: "ch2-009", markdown: f5.md }, state)).rejects.toThrow("not to repair");
    expect(await STAGES.repair!.apply(store, job, state, ctx)).toBe(true);
    const s = await store.source("ch2");
    expect(s?.asks).toEqual([{ question: "Use it?", choices: ["use", "remove"] }]);
    expect(s?.fixes).toEqual([]);
    expect(s?.stage).toBe("label");
  });

  it("refuses a fragment the review didn't ask to repair", async () => {
    const state = { store, job, answers: [] };
    await expect(STAGES.repair!.accept("material_repair", { id: "ch2-001", markdown: "x" }, state)).rejects.toThrow("not to repair");
  });

  it("a session that answers nothing still moves on to labelling", async () => {
    expect(await STAGES.repair!.apply(store, job, { store, job, answers: [] }, ctx)).toBe(true);
    expect(await store.source("ch2")).toMatchObject({ stage: "label", fixes: [] });
    expect((await store.readFragment("ch2-005"))?.meta.validated).toBe("not-reviewed");
  });

  it("a source removed while the stage ran is left alone", async () => {
    const state = { store, job, answers: [] };
    await STAGES.repair!.accept("material_repair", { id: "ch2-005", markdown: table }, state);
    await store.patch("ch2", (s) => ({ ...s, status: "removed" }));
    expect(await STAGES.repair!.apply(store, job, state, ctx)).toBe(true);
    expect(await store.source("ch2")).toMatchObject({ status: "removed", stage: "repair" });
    expect((await store.readFragment("ch2-005"))?.md).toBe(f5.md);
  });
});

describe("the full review (§7)", () => {
  it("waits for the person with its own estimate: every fragment reviewed and labelled, and the sheet", async () => {
    await store.patch("ch2", (s) => ({ ...s, stage: "review", repairs: [], reviewQueue: ["ch2-005"] }));
    await applyReview(store, { ...job, stage: "review" }, { verdict: "usable-with-fixes", fragments: [{ id: "ch2-005", decision: "ok" }], issues: [], fullReview: true }, { items: false });
    expect(await store.source("ch2")).toMatchObject({ status: "pending", notice: "full-review", estimate: LABEL_TOKENS + REVIEW_TOKENS + SHEET_TOKENS });
  });

  it("`use` goes on without it, with what the sample found", async () => {
    await store.patch("ch2", (s) => ({ ...s, status: "pending", notice: "full-review", stage: undefined }));
    expect(await decide(store, "ch2", null, "use", async () => {})).toBe(true);
    expect(await store.source("ch2")).toMatchObject({ status: "validating", stage: "repair" });
    expect((await store.source("ch2"))?.notice).toBeUndefined();
  });
});

describe("decide (§6.2 ask)", () => {
  it("drop a fragment; keep one; use or remove a source", async () => {
    await store.patch("ch2", (s) => ({ ...s, asks: [{ fragment: "ch2-005", question: "?", choices: ["keep", "drop"] }] }));
    expect(await decide(store, "ch2", "ch2-005", "drop", async () => {})).toBe(true);
    expect((await store.source("ch2"))?.fragments).toEqual([]);
    expect((await store.source("ch2"))?.asks).toEqual([]);
    expect((await store.source("ch2"))?.repairs).toEqual([]);
    expect(await store.readFragment("ch2-005")).toBeNull();
    expect((await store.readOriginalVersion("ch2-005"))?.md).toBe(f5.md);
    await store.patch("ch2", (s) => ({ ...s, status: "needs-person", asks: [{ question: "?", choices: ["use", "remove"] }] }));
    expect(await decide(store, "ch2", null, "use", async () => {})).toBe(true);
    // Used as it is, it is still labelled.
    expect(await store.source("ch2")).toMatchObject({ status: "validating", stage: "label", asks: [] });
    expect(await decide(store, "ch2", null, "keep", async () => {})).toBe(false);
  });

  it("questions a hand edit broke are left out, never thrown on", async () => {
    await store.patch("ch2", (s) => ({ ...s, asks: [null, { question: "?", choices: "drop" }, { choices: ["drop"] }, { fragment: "ch2-005", question: "?", choices: ["keep", "x"] }] as never }));
    expect(asksOf((await store.source("ch2"))!)).toEqual([{ fragment: "ch2-005", question: "?", choices: ["keep"] }]);
    expect(await decide(store, "ch2", "ch2-005", "drop", async () => {})).toBe(false);
    expect(await decide(store, "ch2", "ch2-005", "keep", async () => {})).toBe(true);
    expect((await store.source("ch2"))?.asks).toEqual([]);
    await store.patch("ch2", (s) => ({ ...s, asks: "nonsense" as never }));
    expect(await decide(store, "ch2", "ch2-005", "keep", async () => {})).toBe(false);
  });

  it("an ask naming another source's fragment leaves that fragment alone", async () => {
    const other: SourceEntry = { ...entry, id: "ch3", path: "ch3.pdf", stage: "label", repairs: [] };
    const f: Fragment = { ...f5, meta: { ...f5.meta, id: "ch3-001", source: "ch3.pdf" } };
    await store.update((list) => [...list, other]);
    await store.writeFragments("ch3", [f]);
    for (const choice of ["drop", "keep"] as const) {
      await store.patch("ch2", (s) => ({ ...s, asks: [{ fragment: "ch3-001", question: "?", choices: ["keep", "drop"] }] }));
      expect(await decide(store, "ch2", "ch3-001", choice, async () => {})).toBe(true);
      expect(await store.readFragment("ch3-001")).toEqual(f);
      expect((await store.source("ch3"))?.fragments).toEqual(["ch3-001"]);
      expect((await store.source("ch2"))?.fragments).toEqual(["ch2-005"]);
    }
  });

  it("keep the program's version: the fragment stays, looked at by the person", async () => {
    await store.patch("ch2", (s) => ({ ...s, asks: [{ fragment: "ch2-005", question: "?", choices: ["program", "drop"] }] }));
    expect(await decide(store, "ch2", "ch2-005", "keep", async () => {})).toBe(false);
    expect(await decide(store, "ch2", "ch2-005", "program", async () => {})).toBe(true);
    expect(await store.readFragment("ch2-005")).toMatchObject({ md: f5.md, meta: { validated: "flagged-reviewed" } });
    expect((await store.source("ch2"))?.asks).toEqual([]);
  });

  it("remove: the original goes to the Trash, the fragments go, the source is marked removed", async () => {
    await store.patch("ch2", (s) => ({ ...s, status: "needs-person", asks: [{ question: "?", choices: ["use", "remove"] }] }));
    const trashed: string[] = [];
    expect(await decide(store, "ch2", null, "remove", async (file) => void trashed.push(file))).toBe(true);
    expect(trashed).toEqual([path.join(base, "material", "fractions", "ch2.pdf")]);
    expect(await store.source("ch2")).toMatchObject({ status: "removed", fragments: [], asks: [] });
    expect(await store.readFragment("ch2-005")).toBeNull();
    expect(await store.stale()).toBe("sheet");
  });
});
