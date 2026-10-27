import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MaterialStore, type SourceEntry } from "@humanharness/material";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFLICTS_PER_TASK, personMaterialRequest } from "../src/main/material-requests";

let base: string;
const entry: SourceEntry = { id: "ch2", scope: "fractions", path: "ch2.pdf", hash: "x", type: "pdf", family: "pdf", pages: 1, sizeBytes: 1, skippedPages: [], status: "ready", issues: [], fixes: [], estimate: 0, fragments: [], addedAt: "2026-10-27T00:00:00.000Z" };
beforeEach(async () => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mreq-"));
  const store = new MaterialStore(base, "fractions");
  await store.update(() => [entry]);
  await store.writeFragments("ch2", [{ meta: { id: "ch2-001", source: "ch2.pdf", location: "p.1", path: "Fractions", summary: "Halves.", keywords: ["half"], tokens: 10, items: [], checks: "ok", validated: "sample" }, md: "A half is one of two equal parts." }]);
});
afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

const deps = (scope: string | null) => ({ base: async () => base, runningTask: async () => (scope ? { id: "t1", scope } : null), now: () => new Date("2026-10-27T10:00:00.000Z") });

describe("personMaterialRequest", () => {
  it("read: the fragment, and a line in material-reads.jsonl", async () => {
    expect(await personMaterialRequest(deps("fractions"), { op: "read", id: "ch2-001" })).toContain("A half is one of two equal parts.");
    expect(fs.readFileSync(path.join(base, ".harness", "material-reads.jsonl"), "utf8")).toBe('{"at":"2026-10-27T10:00:00.000Z","task":"t1","scope":"fractions","id":"ch2-001"}\n');
  });
  it("search and flag", async () => {
    expect(await personMaterialRequest(deps("fractions"), { op: "search", query: "half" })).toEqual([{ id: "ch2-001", where: "ch2.pdf, p.1", path: "Fractions", summary: "Halves." }]);
    let woke = 0;
    const d = { ...deps("fractions"), flagged: () => void woke++ };
    expect(await personMaterialRequest(d, { op: "flag", id: "ch2-001", reason: "cut" })).toBe("Thanks: it will be checked again.");
    // The flag wakes the queue of AI stages; a refused one doesn't.
    expect(woke).toBe(1);
    await expect(personMaterialRequest(d, { op: "flag", id: "ch2-009", reason: "cut" })).rejects.toThrow();
    expect(woke).toBe(1);
  });
  it("conflict: one line in conflicts.md", async () => {
    expect(await personMaterialRequest(deps("fractions"), { op: "conflict", fragment: "ch2-001", claim: "1/2 > 2/3", resolution: "Followed the material" })).toBe("Noted.");
    expect(fs.readFileSync(path.join(base, ".harness", "material", "fractions", "conflicts.md"), "utf8")).toContain("[[frag:ch2-001]] 1/2 > 2/3 → Followed the material");
  });
  it("conflict: at most CONFLICTS_PER_TASK lines per task", async () => {
    const note = (task: string) => personMaterialRequest({ ...deps("fractions"), runningTask: async () => ({ id: task, scope: "fractions" }) }, { op: "conflict", fragment: "ch2-001", claim: "c", resolution: "r" });
    for (let i = 0; i < CONFLICTS_PER_TASK; i++) expect(await note("t9")).toBe("Noted.");
    await expect(note("t9")).rejects.toThrow(`This task already noted ${CONFLICTS_PER_TASK} conflicts`);
    // Another task has its own count.
    expect(await note("t10")).toBe("Noted.");
    const lines = fs.readFileSync(path.join(base, ".harness", "material", "fractions", "conflicts.md"), "utf8").split("\n").filter((l) => l.startsWith("- "));
    expect(lines).toHaveLength(CONFLICTS_PER_TASK + 1);
  });

  it("conflict: an unknown fragment or a missing field is refused, and nothing is written", async () => {
    await expect(personMaterialRequest(deps("fractions"), { op: "conflict", fragment: "ch2-009", claim: "x", resolution: "y" })).rejects.toThrow("No fragment ch2-009");
    await expect(personMaterialRequest(deps("fractions"), { op: "conflict", fragment: "../x-001", claim: "x", resolution: "y" })).rejects.toThrow("No fragment ../x-001");
    await expect(personMaterialRequest(deps("fractions"), { op: "conflict", fragment: "ch2-001", claim: "x" })).rejects.toThrow("Unknown request");
    expect(fs.existsSync(path.join(base, ".harness", "material", "fractions", "conflicts.md"))).toBe(false);
  });
  it("uses the store it is given (one write queue per base and scope)", async () => {
    const asked: string[] = [];
    const store = new MaterialStore(base, "fractions");
    const d = { ...deps("fractions"), store: (b: string, scope: string) => (asked.push(`${b}|${scope}`), store) };
    await personMaterialRequest(d, { op: "read", id: "ch2-001" });
    expect(asked).toEqual([`${base}|fractions`]);
  });
  it("refusals: no task, `_app`, an unknown fragment, an unknown op", async () => {
    await expect(personMaterialRequest(deps(null), { op: "read", id: "ch2-001" })).rejects.toThrow("No task is running");
    await expect(personMaterialRequest(deps("_app"), { op: "read", id: "ch2-001" })).rejects.toThrow("This task has no material");
    await expect(personMaterialRequest(deps("fractions"), { op: "read", id: "ch2-009" })).rejects.toThrow("No fragment ch2-009");
    await expect(personMaterialRequest(deps("fractions"), { op: "read", id: "../x" })).rejects.toThrow("No fragment ../x");
    await expect(personMaterialRequest(deps("fractions"), { op: "drop" })).rejects.toThrow("Unknown request");
    expect(fs.existsSync(path.join(base, ".harness", "material-reads.jsonl"))).toBe(false);
  });
});
