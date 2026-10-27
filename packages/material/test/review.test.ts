import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fragment, MaterialStore, STAGES, STAGE_TOOLS, type SourceEntry, applyReview, flagFragment, reviewPrompt, reviewSet } from "../src";
import "../src/stages";

let base: string;
let store: MaterialStore;
const frag = (n: number, md: string, checks: Fragment["meta"]["checks"] = "ok"): Fragment => ({
  meta: { id: `ch2-${String(n).padStart(3, "0")}`, source: "ch2.md", location: `lines ${n}`, path: `T › P${n}`, summary: "", keywords: [], tokens: 50, items: [], checks, validated: "not-reviewed" },
  md,
});
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.md", hash: "x", type: "md", family: "text", pages: 1, sizeBytes: 1, skippedPages: [], status: "validating", stage: "review", issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
const ctx = { fragmentKinds: [], sheetSections: [], sheetMaxTokens: 800 };

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-review-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  const list = Array.from({ length: 30 }, (_, i) => frag(i + 1, `Paragraph ${i + 1}.\n\nSecond line ${i + 1}.`, i === 4 ? ["table"] : "ok"));
  await store.writeFragments("ch2", list);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("reviewSet (§6.2 sample)", () => {
  it("flagged ones, the first unflagged, and 10% of the rest spread evenly, at most 15", async () => {
    const ids = await reviewSet(store, (await store.source("ch2"))!);
    expect(ids[0]).toBe("ch2-005");
    expect(ids).toContain("ch2-001");
    expect(ids.length).toBe(1 + 1 + 3);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("after a first review, only the fragments flagged in use", async () => {
    await store.patch("ch2", (s) => ({ ...s, verdict: "good" }));
    await store.patchFragment("ch2-010", (m) => ({ ...m, validated: "pending" }));
    expect(await reviewSet(store, (await store.source("ch2"))!)).toEqual(["ch2-010"]);
  });
  it("a full review reads every fragment", async () => {
    await store.patch("ch2", (s) => ({ ...s, verdict: "usable-with-fixes", fullReview: true }));
    expect(await reviewSet(store, (await store.source("ch2"))!)).toHaveLength(30);
  });
});

describe("the review stage", () => {
  it("offers material_review; the prompt starts with the stage's marker and holds the fragments", async () => {
    expect(Object.hasOwn(STAGE_TOOLS, "material_review")).toBe(true);
    expect(STAGES.review?.tools).toEqual(["material_review"]);
    const prompt = await STAGES.review!.prompt(store, { scope: "fractions", source: "ch2", stage: "review" }, { ...ctx, fragmentKinds: ["example"] });
    expect(prompt?.startsWith("material-review\n")).toBe(true);
    expect(prompt).toContain("[ch2-005] (checks: table; lines 5; T › P5)");
    expect(prompt).toContain("Paragraph 5.");
    expect((await store.source("ch2"))?.reviewQueue).toHaveLength(5);
  });

  it("accept refuses fragments outside the batch and answers that break the schema", async () => {
    const state = { store, job: { scope: "fractions", source: "ch2", stage: "review" as const }, answers: [] };
    await STAGES.review!.prompt(store, state.job, ctx);
    await expect(STAGES.review!.accept("material_review", { verdict: "good", fragments: [{ id: "ch2-029", decision: "ok" }], issues: [] }, state)).rejects.toThrow("not in this batch");
    await expect(STAGES.review!.accept("material_review", { verdict: "fine", fragments: [], issues: [] }, state)).rejects.toThrow();
    expect(await STAGES.review!.accept("material_review", { verdict: "good", fragments: [{ id: "ch2-005", decision: "ok" }], issues: [] }, state)).toBe("Saved.");
    expect(state.answers).toHaveLength(1);
  });

  it("apply: no answer is a failed stage; an answer moves the source on; nothing to review goes straight to labelling", async () => {
    const job = { scope: "fractions", source: "ch2", stage: "review" as const };
    const state = { store, job, answers: [] as Record<string, unknown>[] };
    await STAGES.review!.prompt(store, job, ctx);
    expect(await STAGES.review!.apply(store, job, state, ctx)).toBe(false);
    const batch = (await store.source("ch2"))!.reviewQueue!;
    await STAGES.review!.accept("material_review", { verdict: "good", fragments: batch.map((id) => ({ id, decision: "ok" })), issues: [] }, state);
    expect(await STAGES.review!.apply(store, job, state, ctx)).toBe(true);
    expect(await store.source("ch2")).toMatchObject({ stage: "label", verdict: "good" });

    await store.patch("ch2", (s) => ({ ...s, stage: "review" }));
    expect(await STAGES.review!.prompt(store, job, ctx)).toBeNull();
    expect(await STAGES.review!.apply(store, job, { store, job, answers: [] }, ctx)).toBe(true);
    expect((await store.source("ch2"))?.stage).toBe("label");
  });
});

describe("applyReview", () => {
  const job = { scope: "fractions", source: "ch2", stage: "review" as const };

  it("good: reviewed fragments are marked; the source goes to labelling", async () => {
    const batch = await reviewSet(store, (await store.source("ch2"))!);
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: batch }));
    await applyReview(store, job, { verdict: "good", fragments: batch.map((id) => ({ id, decision: "ok" })), issues: [] }, { items: false });
    expect((await store.readFragment("ch2-005"))?.meta.validated).toBe("flagged-reviewed");
    expect((await store.readFragment("ch2-001"))?.meta.validated).toBe("sample");
    expect((await store.readFragment("ch2-002"))?.meta.validated).toBe("not-reviewed");
    expect(await store.source("ch2")).toMatchObject({ verdict: "good", stage: "label", status: "validating" });
    expect((await store.source("ch2"))?.reviewQueue).toBeUndefined();
  });

  it("merge, split and drop are carried out by the program; old versions kept", async () => {
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-001", "ch2-003", "ch2-005"] }));
    await applyReview(
      store,
      job,
      {
        verdict: "usable-with-fixes",
        fragments: [
          { id: "ch2-001", decision: "merge", with: "ch2-002" },
          { id: "ch2-003", decision: "split", at: 2 },
          { id: "ch2-005", decision: "drop" },
        ],
        issues: ["Two fragments cut mid-sentence"],
      },
      { items: false },
    );
    const s = (await store.source("ch2"))!;
    expect(s.fragments.slice(0, 4)).toEqual(["ch2-001", "ch2-003", "ch2-031", "ch2-004"]);
    expect(s.fragments).not.toContain("ch2-005");
    expect(s.fragments).not.toContain("ch2-002");
    expect((await store.readFragment("ch2-001"))?.md).toBe("Paragraph 1.\n\nSecond line 1.\n\nParagraph 2.\n\nSecond line 2.");
    expect((await store.readFragment("ch2-003"))?.md).toBe("Paragraph 3.");
    expect((await store.readFragment("ch2-031"))?.md).toBe("Second line 3.");
    expect(await store.readFragment("ch2-005")).toBeNull();
    expect(await store.readFragment("ch2-002")).toBeNull();
    expect(await store.readOriginalVersion("ch2-005")).not.toBeNull();
    expect((await store.readOriginalVersion("ch2-003"))?.md).toBe("Paragraph 3.\n\nSecond line 3.");
    expect(s.fixes).toEqual(["Merged ch2-001 and ch2-002", "Split ch2-003", "Dropped ch2-005"]);
    expect(s.issues).toEqual(["Two fragments cut mid-sentence"]);
    expect(fs.readFileSync(path.join(store.dir, "index.md"), "utf8")).not.toContain("ch2-005");
  });

  it("a split never reuses the id of a fragment dropped earlier (its kept version names it)", async () => {
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-030"] }));
    await applyReview(store, job, { verdict: "good", fragments: [{ id: "ch2-030", decision: "drop" }], issues: [] }, { items: false });
    await store.patch("ch2", (s) => ({ ...s, status: "validating", stage: "review", reviewQueue: ["ch2-003"] }));
    await applyReview(store, job, { verdict: "good", fragments: [{ id: "ch2-003", decision: "split", at: 2 }], issues: [] }, { items: false });
    expect((await store.source("ch2"))!.fragments).toContain("ch2-031");
    expect((await store.readOriginalVersion("ch2-030"))?.md).toBe("Paragraph 30.\n\nSecond line 30.");
  });

  it("repairs, questions and queued ids for fragments a later decision merged or dropped are forgotten", async () => {
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-002", "ch2-001", "ch2-005", "ch2-004"] }));
    await applyReview(
      store,
      job,
      {
        verdict: "usable-with-fixes",
        fragments: [
          { id: "ch2-002", decision: "repair", issue: "Broken list" },
          { id: "ch2-005", decision: "ask", question: "Footnote?" },
          { id: "ch2-001", decision: "merge", with: "ch2-002" },
          { id: "ch2-004", decision: "merge", with: "ch2-005" },
        ],
        issues: [],
      },
      { items: false },
    );
    const s = (await store.source("ch2"))!;
    expect(s.repairs).toEqual([]);
    expect(s.asks).toEqual([]);
    expect(s.stage).toBe("label");
  });

  it("the prompt names each fragment's next one and how it starts, so a merge can name it", async () => {
    const s = (await store.source("ch2"))!;
    const prompt = await reviewPrompt(store, s, ["ch2-004", "ch2-030"]);
    expect(prompt).toContain('Next: ch2-005, starting "Paragraph 5."');
    expect(prompt).toContain("Next: none (the last fragment)");
  });

  it("decisions that can't be carried out are left alone", async () => {
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-001", "ch2-003"] }));
    await applyReview(
      store,
      job,
      {
        verdict: "good",
        fragments: [
          { id: "ch2-001", decision: "merge", with: "ch2-007" },
          { id: "ch2-003", decision: "split", at: 9 },
          { id: "ch2-010", decision: "drop" },
        ],
        issues: [],
      },
      { items: false },
    );
    expect((await store.source("ch2"))!.fragments).toHaveLength(30);
    expect((await store.source("ch2"))!.fixes).toEqual([]);
  });

  it("batches: the rest of the queue is the next run of the same stage", async () => {
    const queue = Array.from({ length: 25 }, (_, i) => `ch2-${String(i + 1).padStart(3, "0")}`);
    await store.patch("ch2", (s) => ({ ...s, fullReview: true, reviewQueue: queue }));
    await applyReview(store, job, { verdict: "good", fragments: [], issues: [] }, { items: false });
    expect(await store.source("ch2")).toMatchObject({ stage: "review", reviewQueue: queue.slice(20) });
    await applyReview(store, job, { verdict: "good", fragments: [], issues: [] }, { items: false });
    const s = (await store.source("ch2"))!;
    expect(s).toMatchObject({ stage: "label" });
    expect(s.reviewQueue).toBeUndefined();
    expect(s.fullReview).toBeUndefined();
  });

  it("a fragment flagged in use while the review ran is reviewed next, not lost", async () => {
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-001"] }));
    await flagFragment(store, "ch2-020", "Garbled");
    await applyReview(store, job, { verdict: "good", fragments: [{ id: "ch2-001", decision: "ok" }], issues: [] }, { items: false });
    const s = (await store.source("ch2"))!;
    expect(s).toMatchObject({ stage: "review", verdict: "good" });
    expect(await reviewSet(store, s)).toEqual(["ch2-020"]);
  });

  it("repairs and asks wait for the next stage", async () => {
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-005", "ch2-006"] }));
    await applyReview(
      store,
      job,
      {
        verdict: "usable-with-fixes",
        fragments: [
          { id: "ch2-005", decision: "repair", issue: "The table lost its columns" },
          { id: "ch2-006", decision: "ask", question: "Is this a footnote?" },
        ],
        issues: [],
      },
      { items: false },
    );
    expect(await store.source("ch2")).toMatchObject({
      stage: "repair",
      repairs: [{ id: "ch2-005", issue: "The table lost its columns" }],
      asks: [{ fragment: "ch2-006", question: "Is this a footnote?", choices: ["keep", "drop"] }],
    });
  });

  it("asks a full review: the source waits for the person", async () => {
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-001"] }));
    await applyReview(store, job, { verdict: "usable-with-fixes", fragments: [], issues: [], fullReview: true }, { items: false });
    const s = (await store.source("ch2"))!;
    expect(s).toMatchObject({ status: "pending", notice: "full-review" });
    expect(s.stage).toBeUndefined();
  });

  it("not-usable: one reconversion for a PDF, then the person decides", async () => {
    await store.keepOriginal("ch2-007");
    await store.patch("ch2", (s) => ({
      ...s,
      type: "pdf",
      family: "pdf",
      reviewQueue: ["ch2-001"],
      fixes: ["Dropped ch2-007"],
      repairs: [{ id: "ch2-002", issue: "x" }],
      asks: [{ fragment: "ch2-003", question: "?", choices: ["keep", "drop"] }],
    }));
    const reconverted: unknown[] = [];
    const reconvert = async (settings: unknown) => void reconverted.push(settings);
    await applyReview(store, job, { verdict: "not-usable", fragments: [], issues: ["Columns are mixed"], reconvert: true }, { items: false, reconvert });
    expect(reconverted).toEqual([{ columns: true }]);
    const s = (await store.source("ch2"))!;
    // The reconversion starts over: no verdict, repairs, questions, fixes or kept versions (the ids name new text).
    expect(s).toMatchObject({ reconverted: 1, status: "converting", fixes: [], settings: { columns: true } });
    expect(s.verdict).toBeUndefined();
    expect(s.repairs).toBeUndefined();
    expect(s.asks).toBeUndefined();
    expect(await store.readOriginalVersion("ch2-007")).toBeNull();
    // What processSource does once it converted again.
    await store.patch("ch2", (e) => ({ ...e, status: "validating", stage: "review", reviewQueue: ["ch2-001"] }));
    await applyReview(store, job, { verdict: "not-usable", fragments: [], issues: [] }, { items: false, reconvert });
    expect(reconverted).toHaveLength(1);
    expect(await store.source("ch2")).toMatchObject({ status: "needs-person", asks: [{ question: expect.stringContaining("ch2.md"), choices: ["use", "remove"] }] });
  });

  it("not-usable for a family that can't be converted another way goes to the person at once", async () => {
    await store.patch("ch2", (s) => ({ ...s, reviewQueue: ["ch2-001"] }));
    const reconvert = async () => undefined;
    await applyReview(store, job, { verdict: "not-usable", fragments: [], issues: [] }, { items: false, reconvert });
    expect(await store.source("ch2")).toMatchObject({ status: "needs-person", verdict: "not-usable" });
  });
});
