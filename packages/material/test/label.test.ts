import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Fragment, MaterialStore, STAGES, STAGE_TOOLS, type SourceEntry, groundingMode, unlabelled } from "../src";

let base: string;
let store: MaterialStore;
const frag = (n: number): Fragment => ({
  meta: { id: `ch2-${String(n).padStart(3, "0")}`, source: "ch2.pdf", location: `p.${n}`, path: `T › P${n}`, summary: `First sentence ${n}.`, keywords: [], tokens: 50, items: [], checks: "ok", validated: "not-reviewed" },
  md: `Texto ${n} sobre fracciones.`,
});
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 9, sizeBytes: 1, skippedPages: [], status: "validating", stage: "label", issues: [], fixes: [], estimate: 0, used: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
const job = { scope: "fractions", source: "ch2", stage: "label" as const };
const ctx = { fragmentKinds: ["explanation", "example"], sheetSections: [], sheetMaxTokens: 800 };
const labels = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => ({ id: `ch2-${String(from + i).padStart(3, "0")}`, summary: "Explains equivalent fractions.", keywords: ["fracciones equivalentes"], kind: "explanation" }));

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-label-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", Array.from({ length: 25 }, (_, i) => frag(i + 1)));
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("the label stage", () => {
  it("batches of 20; the prompt lists the kinds and asks for keywords in the material's language", async () => {
    expect(Object.hasOwn(STAGE_TOOLS, "material_label")).toBe(true);
    expect(STAGES.label!.tools).toEqual(["material_label", "material_flag"]);
    expect((await unlabelled(store, "ch2")).length).toBe(25);
    const prompt = (await STAGES.label!.prompt(store, job, ctx))!;
    expect(prompt.startsWith("material-label\n")).toBe(true);
    expect(prompt).toContain("explanation, example");
    expect(prompt).toContain("in the material's own language");
    expect(prompt).toContain("[ch2-020]");
    expect(prompt).not.toContain("[ch2-021]");
  });

  it("applies labels; refuses unknown kinds and ids outside the batch; ready after the last batch", async () => {
    const state = { store, job, answers: [], ctx };
    await STAGES.label!.prompt(store, job, ctx);
    await expect(STAGES.label!.accept("material_label", { fragments: [{ ...labels(1, 1)[0], kind: "poem" }] }, state)).rejects.toThrow('"poem" is not a fragment kind');
    await expect(STAGES.label!.accept("material_label", { fragments: labels(21, 21) }, state)).rejects.toThrow("not in this batch");
    expect(await STAGES.label!.accept("material_label", { fragments: labels(1, 20) }, state)).toBe("Saved.");
    const before = JSON.stringify(await store.source("ch2"));
    expect(await STAGES.label!.apply(store, job, state, ctx)).toBe(true);
    expect((await store.readFragment("ch2-001"))?.meta).toMatchObject({ summary: "Explains equivalent fractions.", keywords: ["fracciones equivalentes"], kind: "explanation" });
    expect(await store.source("ch2")).toMatchObject({ status: "validating", stage: "label", labelled: 20 });
    // A batch done changes the source, so the queue runs the next one instead of skipping it.
    expect(JSON.stringify(await store.source("ch2"))).not.toBe(before);
    expect(await store.stale()).toBeNull();

    const state2 = { store, job, answers: [], ctx };
    const prompt = (await STAGES.label!.prompt(store, job, ctx))!;
    expect(prompt).toContain("[ch2-021]");
    expect(prompt).not.toContain("[ch2-001]");
    await STAGES.label!.accept("material_label", { fragments: labels(21, 25) }, state2);
    await STAGES.label!.apply(store, job, state2, ctx);
    const done = await store.source("ch2");
    expect(done?.status).toBe("ready");
    expect(done?.stage).toBeUndefined();
    expect(done?.labelled).toBeUndefined();
    expect(await store.stale()).toBe("sheet");
    expect(fs.readFileSync(path.join(store.dir, "index.md"), "utf8")).toContain("| ch2-025 |");
  });

  it("no answer: the stage fails", async () => {
    await STAGES.label!.prompt(store, job, ctx);
    expect(await STAGES.label!.apply(store, job, { store, job, answers: [], ctx }, ctx)).toBe(false);
  });

  it("a source that moved on meanwhile is left as it is, and that is no failure", async () => {
    const state = { store, job, answers: [], ctx };
    await STAGES.label!.accept("material_label", { fragments: labels(1, 20) }, state);
    await store.patch("ch2", (e) => ({ ...e, status: "removed", stage: undefined }));
    expect(await STAGES.label!.apply(store, job, state, ctx)).toBe(true);
    expect((await store.readFragment("ch2-001"))?.meta.keywords).toEqual([]);
    expect((await store.source("ch2"))?.status).toBe("removed");
    expect(await store.stale()).toBeNull();
  });

  it("a flag while labelling keeps the batch's labels, then sends the source back to review; only the source's own fragments", async () => {
    await store.update((list) => [...list, { ...entry, id: "other", path: "other.pdf", fragments: ["other-001"] }]);
    const state = { store, job, answers: [], ctx };
    await expect(STAGES.label!.accept("material_flag", { id: "other-001", reason: "garbled" }, state)).rejects.toThrow("other-001 is not a fragment of this source");
    expect(await STAGES.label!.accept("material_flag", { id: "ch2-003", reason: "garbled" }, state)).toContain("checked again");
    // Nothing moves until the session's answers are applied.
    expect(await store.source("ch2")).toMatchObject({ status: "validating", stage: "label" });
    await STAGES.label!.accept("material_label", { fragments: labels(1, 20) }, state);
    expect(await STAGES.label!.apply(store, job, state, ctx)).toBe(true);
    expect((await store.readFragment("ch2-001"))?.meta.keywords).toEqual(["fracciones equivalentes"]);
    expect((await store.readFragment("ch2-003"))?.meta).toMatchObject({ validated: "pending", keywords: ["fracciones equivalentes"] });
    const s = await store.source("ch2");
    expect(s).toMatchObject({ status: "validating", stage: "review" });
    expect(s?.issues).toContain("Flagged while labelling: ch2-003: garbled");
    expect(await store.stale()).toBeNull();
  });

  it("a fragment flagged again after its review is only noted: no second review, the source gets ready", async () => {
    await store.writeFragments("ch2", [frag(1), { ...frag(2), meta: { ...frag(2).meta, validated: "flagged-reviewed" } }]);
    const state = { store, job, answers: [], ctx };
    expect(await STAGES.label!.accept("material_flag", { id: "ch2-002", reason: "still garbled" }, state)).toContain("already checked");
    await STAGES.label!.accept("material_label", { fragments: labels(1, 2) }, state);
    expect(await STAGES.label!.apply(store, job, state, ctx)).toBe(true);
    const s = await store.source("ch2");
    expect(s?.status).toBe("ready");
    expect(s?.issues).toContain("Flagged while labelling, already checked: ch2-002: still garbled");
    expect((await store.readFragment("ch2-002"))?.meta.validated).toBe("flagged-reviewed");
    expect(await store.stale()).toBe("sheet");
  });

  it("nothing left to label: ready at once, with no session", async () => {
    await store.writeFragments("ch2", [{ ...frag(1), meta: { ...frag(1).meta, keywords: ["x"] } }]);
    expect(await STAGES.label!.prompt(store, job, ctx)).toBeNull();
    expect(await STAGES.label!.apply(store, job, { store, job, answers: [], ctx }, ctx)).toBe(true);
    expect((await store.source("ch2"))?.status).toBe("ready");
    expect(await store.stale()).toBe("sheet");
  });
});

describe("the grounding mode", () => {
  it("the person's choice only counts when the harness lets them change it", () => {
    expect(groundingMode("strict", { default: "mixed", personCanChange: true })).toBe("strict");
    expect(groundingMode(null, { default: "mixed", personCanChange: true })).toBe("mixed");
    expect(groundingMode("mixed", { default: "strict", personCanChange: false })).toBe("strict");
  });
});
