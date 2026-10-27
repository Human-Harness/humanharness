import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MaterialStore, STAGES, type SourceEntry, composeSheet, sheetPrompt } from "../src";

let base: string;
let store: MaterialStore;
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 9, sizeBytes: 1, skippedPages: [], status: "ready", issues: [], fixes: [], estimate: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
const sections = [{ id: "terms", label: "Key terms", prompt: "List the key terms with a one-line definition." }];
const ctx = { fragmentKinds: ["explanation"], sheetSections: sections, sheetMaxTokens: 200 };
const job = { scope: "fractions", stage: "sheet" as const };

beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-sheet-"));
  store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", [{ meta: { id: "ch2-001", source: "ch2.pdf", location: "p.1", path: "Fractions", kind: "explanation", summary: "Defines a fraction.", keywords: ["fracción"], tokens: 50, items: [], checks: "ok", validated: "sample" }, md: "Una fracción…" }]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("composeSheet", () => {
  it("the harness's sections, then the core ones, under their labels, cut at a line to the budget", () => {
    const md = composeSheet(sections, [{ id: "not-covered", markdown: "Decimals." }, { id: "terms", markdown: "- fraction: a part of a whole" }, { id: "notation", markdown: "a/b" }], 800);
    expect(md).toBe("## Key terms\n\n- fraction: a part of a whole\n\n## Notation and conventions\n\na/b\n\n## What the material does not cover\n\nDecimals.");
    const long = composeSheet(sections, [{ id: "terms", markdown: Array.from({ length: 100 }, (_, i) => `- term ${i}: something`).join("\n") }], 100);
    expect(long.length).toBeLessThanOrEqual(100 * 4);
    expect(long.endsWith("something")).toBe(true);
  });

  it("a cut never ends on blank lines or a heading with nothing under it", () => {
    // The budget reaches the next section's heading but not its first line.
    const md = composeSheet(sections, [{ id: "terms", markdown: "- fraction" }, { id: "notation", markdown: "x".repeat(400) }], 15);
    expect(md).toBe("## Key terms\n\n- fraction");
  });
});

describe("sheetPrompt", () => {
  const row = (n: number, summary = `Summary ${n}.`) => ({ id: `ch2-${String(n).padStart(3, "0")}`, where: "ch2.pdf, p.1", path: "Fractions", kind: "explanation", summary, items: [] });

  it("escapes a backslash before a pipe, so a cell can't break the table", () => {
    const prompt = sheetPrompt(sections, [row(1, "a \\| b")], 800);
    expect(prompt).toContain("| a \\\\\\| b |");
  });

  it("a big index is cut to its token budget, with a line counting the rest", () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(i + 1));
    const prompt = sheetPrompt(sections, rows, 800, 100);
    expect(prompt).toContain("| ch2-001 |");
    expect(prompt).not.toContain("| ch2-050 |");
    const shown = prompt.split("\n").filter((l) => l.startsWith("| ch2-")).length;
    expect(prompt).toContain(`${50 - shown} more fragments are not listed here`);
    expect(sheetPrompt(sections, rows.slice(0, 2), 800)).not.toContain("more fragments");
  });
});

describe("the sheet stage", () => {
  it("prompts with the index and the sections; writes sheet.md", async () => {
    const prompt = (await STAGES.sheet!.prompt(store, job, ctx))!;
    expect(prompt.startsWith("material-sheet\n")).toBe(true);
    expect(prompt).toContain("terms: Key terms: List the key terms");
    expect(prompt).toContain("notation: Notation and conventions");
    expect(prompt).toContain("| ch2-001 | ch2.pdf, p.1 | Fractions | explanation | Defines a fraction. |");
    const state = { store, job, answers: [], ctx };
    expect(await STAGES.sheet!.accept("material_sheet", { sections: [{ id: "terms", markdown: "- fraction" }] }, state)).toBe("Saved.");
    await expect(STAGES.sheet!.accept("material_sheet", { sections: [{ id: "poems", markdown: "x" }] }, state)).rejects.toThrow('"poems" is not a sheet section');
    expect(await STAGES.sheet!.apply(store, job, state, ctx)).toBe(true);
    expect(await store.sheet()).toBe("## Key terms\n\n- fraction\n");
  });

  it("no usable fragments: an empty sheet, no session", async () => {
    await store.update((l) => l.map((s) => ({ ...s, status: "removed" as const })));
    expect(await STAGES.sheet!.prompt(store, job, ctx)).toBeNull();
    expect(await STAGES.sheet!.apply(store, job, { store, job, answers: [], ctx }, ctx)).toBe(true);
    expect(await store.sheet()).toBe("");
  });
});
