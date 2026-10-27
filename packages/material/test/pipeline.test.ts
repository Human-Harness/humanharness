import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ConvertRunner, ConvertStopped, MAX_BYTES, MAX_PAGES, MaterialStore, addSource, confirmSource, estimateCost, intakeDecision, processSource, refreshSources, sampleSize, workerRunner } from "../src";
import { body, makePdf } from "./make-pdf";

let base: string;
let store: MaterialStore;
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-pipe-"));
  store = new MaterialStore(base, "fractions");
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const chapter = ["# Fractions", "", ...Array.from({ length: 6 }, (_, i) => `## Part ${i + 1}\n\n${"A fraction names a part of a whole. ".repeat(60)}`)].join("\n\n");

describe("intakeDecision (§7)", () => {
  it("small files run at once; big ones wait with the warning; huge ones need a range", () => {
    expect(intakeDecision({ family: "pdf", pages: 10, sizeBytes: 1000, textPages: 10 })).toEqual({ kind: "process" });
    expect(intakeDecision({ family: "pdf", pages: 60, sizeBytes: 1000, textPages: 60 })).toEqual({ kind: "wait", notice: "warn" });
    expect(intakeDecision({ family: "pdf", pages: 400, sizeBytes: 1000, textPages: 400 })).toEqual({ kind: "wait", notice: "max" });
    expect(intakeDecision({ family: "pdf", pages: 10, sizeBytes: 60 * 1024 * 1024, textPages: 10 })).toEqual({ kind: "wait", notice: "max" });
    expect(intakeDecision({ family: "spreadsheet", pages: 1, sizeBytes: 1000, rows: 5000 })).toEqual({ kind: "wait", notice: "rows" });
  });
  it("no text at all is refused as scanned; some pages without text wait for the person", () => {
    expect(intakeDecision({ family: "pdf", pages: 3, sizeBytes: 1000, textPages: 0 })).toEqual({ kind: "refuse", reason: "scanned" });
    expect(intakeDecision({ family: "pdf", pages: 3, sizeBytes: 1000, textPages: 2 })).toEqual({ kind: "wait", notice: "no-text-pages" });
  });
  it("a huge PDF measured only in part compares its text pages with the pages checked", () => {
    expect(intakeDecision({ family: "pdf", pages: 900, sizeBytes: 1000, textPages: 300, checked: 300 })).toEqual({ kind: "wait", notice: "max" });
    expect(intakeDecision({ family: "pdf", pages: 40, sizeBytes: 1000, textPages: 30, checked: 30 })).toEqual({ kind: "process" });
  });
});

describe("estimateCost (§7)", () => {
  it("per fragment, plus the sheet, plus links when the harness has items", () => {
    // 6000 tokens → 10 fragments; label 700, review 900 × 0.1, sheet 4000.
    expect(estimateCost({ tokens: 6000, items: false })).toBe(10 * (700 + 90) + 4000);
    expect(estimateCost({ tokens: 6000, items: true })).toBe(10 * (700 + 90 + 120) + 4000);
    expect(estimateCost({ tokens: 6000, items: false, reviewShare: 1 })).toBe(10 * (700 + 900) + 4000);
    expect(estimateCost({ tokens: 6000, items: false, measured: { label: 100, review: 200, sheet: 50 } })).toBe(10 * (100 + 20) + 50);
  });
});

describe("addSource and confirmSource", () => {
  it("a small Markdown file: original kept, fragments written, validating for review, index rebuilt", async () => {
    const r = await addSource(store, { name: "Fractions.md", data: Buffer.from(chapter) }, { accepts: ["text"], items: false });
    expect(r).toMatchObject({ ok: true, waiting: false });
    if (!r.ok) throw new Error("unreachable");
    const s = (await store.source(r.id))!;
    expect(s).toMatchObject({ id: "fractions", status: "validating", stage: "review", type: "md", family: "text", path: "Fractions.md" });
    expect(s.fragments.length).toBeGreaterThanOrEqual(5);
    expect(s.estimate).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(base, "material", "fractions", "Fractions.md"))).toBe(true);
    const f = (await store.readFragment(s.fragments[1]))!;
    expect(f.meta).toMatchObject({ source: "Fractions.md", validated: "not-reviewed", checks: "ok", items: [], keywords: [] });
    // The heading-only "# Fractions" joins its first part (Task 4), so the second fragment is a later part.
    expect(f.meta.path).toMatch(/^Fractions › Part \d$/);
    expect(f.meta.summary).toBe("A fraction names a part of a whole.");
    expect(fs.readFileSync(path.join(store.dir, "index.md"), "utf8")).toContain(s.fragments[1]);
  });

  it("refusals keep nothing", async () => {
    const r = await addSource(store, { name: "song.mp3", data: Buffer.from("ID3...") }, { accepts: ["text"], items: false });
    expect(r).toMatchObject({ ok: false, reason: "media" });
    const r2 = await addSource(store, { name: "a.md", data: Buffer.from("# A") }, { accepts: ["pdf"], items: false });
    expect(r2).toMatchObject({ ok: false, reason: "not-accepted" });
    expect(fs.existsSync(path.join(base, "material"))).toBe(false);
  });

  it("a converter's refusal at measuring is the source's refusal, and nothing is kept", async () => {
    const r = await addSource(store, { name: "broken.docx", data: Buffer.from("PK\u0003\u0004 broken") }, { accepts: ["word"], items: false });
    expect(r).toMatchObject({ ok: false, reason: "unreadable", message: expect.stringContaining("damaged") });
    expect(fs.existsSync(path.join(base, "material"))).toBe(false);
  });

  it("a PDF without any text layer is refused as scanned", async () => {
    const r = await addSource(store, { name: "scan.pdf", data: makePdf([[], []]) }, { accepts: ["pdf"], items: false });
    expect(r).toMatchObject({ ok: false, reason: "scanned" });
  });

  it("a long PDF waits; confirming with a page range converts only those pages", async () => {
    const pages = Array.from({ length: 60 }, (_, i) => body([`Page ${i + 1} has its own sentence about fractions.`]));
    const r = await addSource(store, { name: "book.pdf", data: makePdf(pages) }, { accepts: ["pdf"], items: false });
    expect(r).toMatchObject({ ok: true, waiting: true });
    if (!r.ok) throw new Error("unreachable");
    expect(await store.source(r.id)).toMatchObject({ status: "pending", notice: "warn", pages: 60, fragments: [] });
    await confirmSource(store, r.id, { pageRange: [2, 3] }, { items: false });
    const s = (await store.source(r.id))!;
    expect(s).toMatchObject({ status: "validating", pageRange: [2, 3] });
    expect(s.notice).toBeUndefined();
    const text = (await store.fragments()).map((f) => f.md).join("\n");
    expect(text).toContain("Page 2 has");
    expect(text).not.toContain("Page 4 has");
  });

  it("a file at the hard limit goes on only with a range shorter than the limit", async () => {
    const r = await addSource(store, { name: "book.pdf", data: makePdf([body(["One page."])]) }, { accepts: ["pdf"], items: false });
    if (!r.ok) throw new Error("unreachable");
    // As if the file had MAX_PAGES + 100 pages: the registry says so.
    await store.patch(r.id, (e) => ({ ...e, status: "pending", notice: "max", pages: MAX_PAGES + 100 }));
    expect(await confirmSource(store, r.id, {}, { items: false })).toBeNull();
    expect(await confirmSource(store, r.id, { pageRange: [1, MAX_PAGES + 50] }, { items: false })).toBeNull();
    expect((await store.source(r.id))!.status).toBe("pending");
    expect(await confirmSource(store, r.id, { pageRange: [1, 1] }, { items: false })).toMatchObject({ status: "validating", pageRange: [1, 1] });
  });

  it("a fragment the checks flag carries its checks in the front matter", async () => {
    const garbled = `# T\n\n${"Text � with broken � characters. ".repeat(40)}`;
    const r = await addSource(store, { name: "bad.md", data: Buffer.from(garbled) }, { accepts: ["text"], items: false });
    if (!r.ok) throw new Error("unreachable");
    const [f] = await store.fragments();
    expect(f.meta.checks).toContain("garbled");
  });

  it("a conversion that fails after intake marks the source refused, never throws", async () => {
    const r = await addSource(store, { name: "notes.md", data: Buffer.from(chapter) }, { accepts: ["text"], items: false });
    if (!r.ok) throw new Error("unreachable");
    // The original changed on disk into something no converter reads.
    fs.writeFileSync(path.join(base, "material", "fractions", "notes.md"), "");
    await store.patch(r.id, (e) => ({ ...e, status: "pending", type: "docx", family: "word" }));
    const before = (await store.source(r.id))!.fragments;
    expect(before.length).toBeGreaterThan(0);
    const s = await confirmSource(store, r.id, {}, { items: false });
    expect(s).toMatchObject({ status: "refused", refusal: "unreadable", fragments: [] });
    expect(s!.stage).toBeUndefined();
    // The old fragments go with it: no file, no index row.
    for (const id of before) expect(fs.existsSync(path.join(store.dir, "fragments", `${id}.md`))).toBe(false);
    expect(fs.readFileSync(path.join(store.dir, "index.md"), "utf8")).not.toContain(before[0]);
  });

  it("two quick answers to one waiting source convert it once", async () => {
    const pages = Array.from({ length: 60 }, (_, i) => body([`Page ${i + 1} has its own sentence.`]));
    const r = await addSource(store, { name: "book.pdf", data: makePdf(pages) }, { accepts: ["pdf"], items: false });
    if (!r.ok) throw new Error("unreachable");
    let converts = 0;
    const runner = { ...workerRunner(), convert: (...a: Parameters<ConvertRunner["convert"]>) => (converts++, workerRunner().convert(...a)) };
    const [a, b] = await Promise.all([confirmSource(store, r.id, { pageRange: [1, 2] }, { items: false, runner }), confirmSource(store, r.id, { pageRange: [3, 4] }, { items: false, runner })]);
    expect(converts).toBe(1);
    expect([a, b].filter((x) => x === null)).toHaveLength(1);
    expect((await store.source(r.id))!.status).toBe("validating");
  });

  it("a sheet choice that names no sheet of the file changes nothing", async () => {
    const csv = Buffer.from(["name,score", ...Array.from({ length: 2100 }, (_, i) => `p${i},${i}`)].join("\n"));
    const r = await addSource(store, { name: "scores.csv", data: csv }, { accepts: ["spreadsheet"], items: false });
    if (!r.ok) throw new Error("unreachable");
    const waiting = (await store.source(r.id))!;
    expect(waiting).toMatchObject({ status: "pending", notice: "rows" });
    expect(await confirmSource(store, r.id, { sheets: [] }, { items: false })).toBeNull();
    expect(await confirmSource(store, r.id, { sheets: ["Nope"] }, { items: false })).toBeNull();
    expect(await store.source(r.id)).toEqual(waiting);
    expect(await confirmSource(store, r.id, { sheets: "summary" }, { items: false })).toMatchObject({ status: "validating", sheets: "summary" });
  });

  it("a link's page is read with readability; a saved page as a whole", async () => {
    const html = `<html><head><title>T</title></head><body><nav>Menu item</nav><article><h1>T</h1>${"<p>Real content sentence about fractions here.</p>".repeat(12)}</article></body></html>`;
    const r = await addSource(store, { name: "t.html", data: Buffer.from(html), url: "https://example.org/t" }, { accepts: ["web"], items: false });
    if (!r.ok) throw new Error("unreachable");
    expect((await store.fragments()).map((f) => f.md).join("\n")).not.toContain("Menu item");
    const saved = await addSource(store, { name: "s.html", data: Buffer.from(html) }, { accepts: ["web"], items: false });
    if (!saved.ok) throw new Error("unreachable");
    expect((await store.fragments()).map((f) => f.md).join("\n")).toContain("Menu item");
  });

  it("a file past the size limit is refused before it is measured", async () => {
    const runner = { convert: () => Promise.reject(new Error("not called")), measure: () => Promise.reject(new Error("not called")) };
    const r = await addSource(store, { name: "big.txt", data: Buffer.alloc(MAX_BYTES + 1, "a") }, { accepts: ["text"], items: false, runner });
    expect(r).toMatchObject({ ok: false, reason: "too-big" });
    expect(fs.existsSync(path.join(base, "material"))).toBe(false);
  });

  it("a conversion stopped (a profile switch, closeRuntime) leaves the source converting, to resume later", async () => {
    const real = workerRunner();
    const runner: ConvertRunner = { measure: real.measure, convert: () => Promise.reject(new ConvertStopped()) };
    const r = await addSource(store, { name: "a.md", data: Buffer.from(chapter) }, { accepts: ["text"], items: false, runner });
    expect(r).toMatchObject({ ok: true, waiting: false });
    if (!r.ok) throw new Error("unreachable");
    expect(await store.source(r.id)).toMatchObject({ status: "converting", fragments: [] });
    expect((await store.source(r.id))?.refusal).toBeUndefined();
    // Resumed: it converts as usual.
    expect(await processSource(store, r.id, { items: false })).toMatchObject({ status: "validating", stage: "review" });
  });

  it("a source removed meanwhile is not converted again nor brought back", async () => {
    const real = workerRunner();
    const r = await addSource(store, { name: "a.md", data: Buffer.from(chapter) }, { accepts: ["text"], items: false, runner: real });
    if (!r.ok) throw new Error("unreachable");
    await store.patch(r.id, (s) => ({ ...s, status: "removed" }));
    let converts = 0;
    const counting: ConvertRunner = { measure: real.measure, convert: (...a) => (converts++, real.convert(...a)) };
    expect(await processSource(store, r.id, { items: false, runner: counting })).toBeNull();
    expect(converts).toBe(0);
    expect((await store.source(r.id))?.status).toBe("removed");
    // Removed while it converted: it stays removed.
    const removing: ConvertRunner = {
      measure: real.measure,
      convert: async (...a) => {
        const c = await real.convert(...a);
        await store.patch(r.id, (s) => ({ ...s, status: "removed" }));
        return c;
      },
    };
    await store.patch(r.id, (s) => ({ ...s, status: "validating" }));
    expect(await processSource(store, r.id, { items: false, runner: removing })).toBeNull();
    expect((await store.source(r.id))?.status).toBe("removed");
  });

  it("the disk failing is a refusal, never a throw, and leaves no stray original", async () => {
    // The originals' folder can't be made: a file is in its way.
    fs.writeFileSync(path.join(base, "material"), "");
    expect(await addSource(store, { name: "a.md", data: Buffer.from(chapter) }, { accepts: ["text"], items: false })).toMatchObject({ ok: false, reason: "storage" });
    fs.rmSync(path.join(base, "material"));
    // The registry can't be read: a folder is where it should be.
    fs.mkdirSync(path.join(store.dir, "sources.json"), { recursive: true });
    expect(await addSource(store, { name: "a.md", data: Buffer.from(chapter) }, { accepts: ["text"], items: false })).toMatchObject({ ok: false, reason: "storage" });
    expect(fs.readdirSync(path.join(base, "material", "fractions"))).toEqual([]);
    expect(await confirmSource(store, "a", {}, { items: false })).toBeNull();
    expect(await processSource(store, "a", { items: false })).toBeNull();
  });
});

describe("sampleSize (§6.2)", () => {
  it("the first unflagged fragment plus 10% of the rest, at most 15", () => {
    expect(sampleSize(200, 0)).toBe(15);
    expect(sampleSize(10, 0)).toBe(2);
    expect(sampleSize(1, 0)).toBe(1);
    expect(sampleSize(10, 3)).toBe(2);
    expect(sampleSize(5, 5)).toBe(0);
  });
});

describe("refreshSources (§11 update)", () => {
  const original = (name: string) => path.join(base, "material", "fractions", name);

  it("a changed original is converted again under the same id; a missing one is removed", async () => {
    const r = await addSource(store, { name: "a.md", data: Buffer.from(`# A\n\n${"First version. ".repeat(40)}`) }, { accepts: ["text"], items: false });
    if (!r.ok) throw new Error("unreachable");
    fs.writeFileSync(original("a.md"), `# A\n\n${"Second version. ".repeat(40)}`);
    expect(await refreshSources(store, { items: false })).toEqual(["a"]);
    expect((await store.fragments()).map((f) => f.md).join("")).toContain("Second version.");
    expect(await store.source("a")).toMatchObject({ status: "validating", stage: "review" });
    expect(await refreshSources(store, { items: false })).toEqual([]);
    fs.rmSync(original("a.md"));
    expect(await refreshSources(store, { items: false })).toEqual(["a"]);
    expect((await store.source("a"))?.status).toBe("removed");
    expect(await store.fragments()).toEqual([]);
    expect(await store.stale()).toBe("sheet");
  });

  it("an update forgets what the AI stages left: verdict, questions, labels so far, settings, .orig copies", async () => {
    const r = await addSource(store, { name: "a.md", data: Buffer.from(chapter) }, { accepts: ["text"], items: false });
    if (!r.ok) throw new Error("unreachable");
    const first = (await store.source("a"))!.fragments[0];
    await store.keepOriginal(first);
    await store.patch("a", (e) => ({
      ...e,
      status: "ready",
      stage: undefined,
      verdict: "usable-with-fixes",
      fixes: ["Merged"],
      asks: [{ fragment: first, question: "?", choices: ["keep", "drop"] }],
      labelled: 3,
      failed: "label",
      reconverted: 1,
      settings: { columns: false },
    }));
    await store.setStale(false);
    fs.writeFileSync(original("a.md"), chapter.replace("# Fractions", "# Fractions, again"));
    expect(await refreshSources(store, { items: false })).toEqual(["a"]);
    const s = (await store.source("a"))!;
    expect(s).toMatchObject({ status: "validating", stage: "review", fixes: [], asks: [], reconverted: 0 });
    expect(s.verdict).toBeUndefined();
    expect(s.labelled).toBeUndefined();
    expect(s.failed).toBeUndefined();
    expect(s.settings).toBeUndefined();
    expect(await store.originalVersionIds("a")).toEqual([]);
    expect(await store.stale()).toBe("sheet");
  });

  it("waiting, refused and removed sources are not looked at", async () => {
    const r = await addSource(store, { name: "a.md", data: Buffer.from(chapter) }, { accepts: ["text"], items: false });
    if (!r.ok) throw new Error("unreachable");
    await store.patch("a", (e) => ({ ...e, status: "pending", notice: "warn" }));
    fs.rmSync(original("a.md"));
    expect(await refreshSources(store, { items: false })).toEqual([]);
    expect((await store.source("a"))?.status).toBe("pending");
  });
});
