import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MaterialStore, type SourceEntry, failStage, nextJob, retryStage } from "../src";

let base: string;
let store: MaterialStore;
const entry = (id: string, over: Partial<SourceEntry>): SourceEntry => ({
  id,
  scope: "fractions",
  path: `${id}.pdf`,
  hash: "x",
  type: "pdf",
  family: "pdf",
  pages: 1,
  sizeBytes: 1,
  skippedPages: [],
  status: "ready",
  issues: [],
  fixes: [],
  estimate: 0,
  used: 0,
  fragments: [],
  addedAt: "2026-10-27T00:00:00.000Z",
  ...over,
});
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-stages-"));
  store = new MaterialStore(base, "fractions");
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

describe("nextJob", () => {
  it("a validating source's stage first, in the order sources were added; then the scope's sheet and links", async () => {
    await store.update(() => [entry("a", { status: "ready" }), entry("b", { status: "validating", stage: "label" }), entry("c", { status: "validating", stage: "review" })]);
    expect(await nextJob(store, { items: true })).toEqual({ scope: "fractions", source: "b", stage: "label" });
    await store.update((l) => l.map((s) => ({ ...s, status: "ready" as const, stage: undefined })));
    expect(await nextJob(store, { items: true })).toBeNull();
    await store.setStale("sheet");
    expect(await nextJob(store, { items: true })).toEqual({ scope: "fractions", stage: "sheet" });
    await store.setStale("link");
    expect(await nextJob(store, { items: true })).toEqual({ scope: "fractions", stage: "link" });
    expect(await nextJob(store, { items: false })).toBeNull();
    await store.setStale(false);
    expect(await store.stale()).toBeNull();
  });

  it("a failed stage leaves the source usable and not retried (§13 failures)", async () => {
    await store.update(() => [entry("a", { status: "validating", stage: "review" })]);
    await failStage(store, { scope: "fractions", source: "a", stage: "review" });
    expect(await store.source("a")).toMatchObject({ status: "ready", failed: "review" });
    expect((await store.source("a"))?.stage).toBeUndefined();
    expect(await nextJob(store, { items: false })).toEqual({ scope: "fractions", stage: "sheet" });
  });
});

describe("retryStage", () => {
  it("sends a failed source back to its stage; a source that didn't fail is left alone", async () => {
    await store.update(() => [entry("a", { status: "ready", failed: "label" }), entry("b", { status: "ready" })]);
    expect(await retryStage(store, "b")).toBe(false);
    expect(await retryStage(store, "a")).toBe(true);
    const a = await store.source("a");
    expect(a).toMatchObject({ status: "validating", stage: "label" });
    expect(a?.failed).toBeUndefined();
    expect(await nextJob(store, { items: false })).toEqual({ scope: "fractions", source: "a", stage: "label" });
  });
});
