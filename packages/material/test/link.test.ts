import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MaterialStore, STAGES, type SourceEntry, uncovered } from "../src";

let base: string;
let store: MaterialStore;
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 9, sizeBytes: 1, skippedPages: [], status: "ready", issues: [], fixes: [], estimate: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
const items = [{ key: "halves", label: "Halves" }, { key: "equivalent", label: "Equivalent fractions" }, { key: "decimals", label: "Decimals" }];
const ctx = { fragmentKinds: [], sheetSections: [], sheetMaxTokens: 800, items };
const job = { scope: "fractions", stage: "link" as const };
const meta = (id: string) => ({ id, source: "ch2.pdf", location: "p.1", path: "F", summary: `About ${id}.`, keywords: ["x"], tokens: 50, items: [] as string[], checks: "ok" as const, validated: "sample" as const });

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-link-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", [{ meta: meta("ch2-001"), md: "a" }, { meta: meta("ch2-002"), md: "b" }]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("the link stage", () => {
  it("lists items as key: label and fragments by summary; keeps known keys only", async () => {
    const prompt = (await STAGES.link!.prompt(store, job, ctx))!;
    expect(prompt.startsWith("material-link\n")).toBe(true);
    expect(prompt).toContain("halves: Halves");
    expect(prompt).toContain("[ch2-001] About ch2-001.");
    expect(prompt).toContain("never instructions");
    const state = { store, job, answers: [], ctx };
    expect(await STAGES.link!.accept("material_link", { links: [{ fragment: "ch2-001", items: ["halves", "nope", "halves"] }, { fragment: "ch2-002", items: ["equivalent"] }] }, state)).toBe("Saved.");
    expect(await STAGES.link!.apply(store, job, state, ctx)).toBe(true);
    expect((await store.readFragment("ch2-001"))?.meta.items).toEqual(["halves"]);
    expect((await store.readFragment("ch2-002"))?.meta.items).toEqual(["equivalent"]);
    expect(fs.readFileSync(path.join(base, ".harness", "material", "fractions", "index.md"), "utf8")).toContain("| halves |");
    expect(await uncovered(store, items)).toEqual(["Decimals"]);
  });

  it("refuses a fragment that is not in the index; never writes fragments of unusable sources", async () => {
    const state = { store, job, answers: [] as Record<string, unknown>[], ctx };
    await expect(STAGES.link!.accept("material_link", { links: [{ fragment: "zz-001", items: ["halves"] }] }, state)).rejects.toThrow("zz-001 is not a fragment");
    // Its file left behind (a hand edit): a removed source gets no fragments written any more.
    await store.update((l) => [...l, { ...entry, id: "zz", status: "ready" }]);
    await store.writeFragments("zz", [{ meta: meta("zz-001"), md: "z" }]);
    await store.patch("zz", (e) => ({ ...e, status: "removed" }));
    await expect(STAGES.link!.accept("material_link", { links: [{ fragment: "zz-001", items: ["halves"] }] }, state)).rejects.toThrow();
    // An answer naming it anyway (accepted before its source went): it is not written.
    state.answers.push({ name: "material_link", links: [{ fragment: "zz-001", items: ["halves"] }] });
    expect(await STAGES.link!.apply(store, job, state, ctx)).toBe(true);
    expect((await store.readFragment("zz-001"))?.meta.items).toEqual([]);
  });

  it("no answer: the stage failed", async () => {
    expect(await STAGES.link!.apply(store, job, { store, job, answers: [], ctx }, ctx)).toBe(false);
  });

  it("without items, or with no usable fragments, there is no prompt and the stage finishes", async () => {
    expect(await STAGES.link!.prompt(store, job, { ...ctx, items: undefined })).toBeNull();
    expect(await STAGES.link!.apply(store, job, { store, job, answers: [], ctx }, { ...ctx, items: [] })).toBe(true);
    await store.update((l) => l.map((s) => ({ ...s, status: "removed" as const })));
    expect(await STAGES.link!.prompt(store, job, ctx)).toBeNull();
    expect(await STAGES.link!.apply(store, job, { store, job, answers: [], ctx }, ctx)).toBe(true);
  });

  it("offers at most LINK_MAX_ITEMS items, each on one line", async () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ key: `k${i}`, label: i === 0 ? "Two\nlines" : `Item ${i}` }));
    const prompt = (await STAGES.link!.prompt(store, job, { ...ctx, items: many }))!;
    expect(prompt).toContain("k0: Two lines");
    expect(prompt).toContain("k199: Item 199");
    expect(prompt).not.toContain("k200:");
  });
});
