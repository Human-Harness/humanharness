import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type DataRules, type RulesContext, dataSchema, z } from "@humanharness/harness-sdk";
import { DataStore } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const LEVELS = ["unseen", "seen", "mastered"];
const concept = z.object({ id: z.string(), state: z.enum(["unseen", "seen", "mastered"]), evidence: z.array(z.string()) });
// The student example (spec §4.3): the state rises only with a new evidence entry.
const rises: DataRules = (next, prev) => {
  if (!next || !prev) return true;
  const up = LEVELS.indexOf(String(next.state)) > LEVELS.indexOf(String(prev.state));
  return !up || (next.evidence as unknown[]).length > (prev.evidence as unknown[]).length ? true : "The state can rise only with a new evidence entry";
};

function store(rules: DataRules, log: string[] = [], slowMs?: number) {
  const data = dataSchema.parse({
    concepts: { scoped: true, key: "id", schema: concept, agent: "write", rules },
    profile: { scoped: false, single: true, schema: z.object({ name: z.string() }), agent: "read" },
  });
  return new DataStore(fs.mkdtempSync(path.join(root, "t-")), data, { log: (m) => void log.push(m), ...(slowMs !== undefined ? { rulesSlowMs: slowMs } : {}) });
}
const agent = { who: "agent" as const, scope: "fracciones", action: "study" };

describe("rules", () => {
  it("refuses with the harness's message, after the schema, on put and patch", async () => {
    const s = store(rises);
    await s.put("concepts", { id: "a", state: "seen", evidence: ["quiz"] }, agent);
    await expect(s.put("concepts", { id: "a", state: "mastered", evidence: ["quiz"] }, agent)).rejects.toMatchObject({ code: "refused", message: "The state can rise only with a new evidence entry" });
    await expect(s.patch("concepts", "a", { state: "mastered" }, agent)).rejects.toThrow(/new evidence/);
    expect(await s.patch("concepts", "a", { state: "mastered", evidence: ["quiz", "exam"] }, agent)).toMatchObject({ state: "mastered" });
    await expect(s.put("concepts", { id: "b", state: "nope", evidence: [] }, agent)).rejects.toMatchObject({ code: "invalid" });
  });

  it("gives the task, the writer and a copy of the other collections; a delete passes next = null", async () => {
    const seen: { next: unknown; prev: unknown; ctx: Omit<RulesContext, "records">; profile: unknown }[] = [];
    const s = store((next, prev, ctx) => {
      seen.push({ next, prev, ctx: { action: ctx.action, scope: ctx.scope, who: ctx.who }, profile: ctx.records("profile") });
      ctx.records("profile").pop();
      return true;
    });
    await s.put("profile", { name: "Ana" }, { who: "person", scope: "fracciones" });
    await s.put("concepts", { id: "a", state: "seen", evidence: [] }, agent);
    await s.delete("concepts", "a", agent);
    expect(seen).toEqual([
      { next: { id: "a", state: "seen", evidence: [] }, prev: null, ctx: { action: "study", scope: "fracciones", who: "agent" }, profile: [{ name: "Ana" }] },
      { next: null, prev: { id: "a", state: "seen", evidence: [] }, ctx: { action: "study", scope: "fracciones", who: "agent" }, profile: [{ name: "Ana" }] },
    ]);
    expect(await s.get("profile", undefined, agent)).toEqual({ name: "Ana" });
  });

  it("can't change the record it checks", async () => {
    const s = store((next) => {
      if (next) next.state = "mastered";
      return true;
    });
    expect(await s.put("concepts", { id: "a", state: "seen", evidence: [] }, agent)).toMatchObject({ state: "seen" });
    expect(await s.get("concepts", "a", agent)).toMatchObject({ state: "seen" });
  });

  it("refuses when the rules throw or answer something else, and logs slow rules (spec §7.4)", async () => {
    const log: string[] = [];
    await expect(
      store(() => {
        throw new Error("bug");
      }).put("concepts", { id: "a", state: "seen", evidence: [] }, agent),
    ).rejects.toThrow(/rules of "concepts" failed: bug/);
    await expect(store((() => 1) as unknown as DataRules).put("concepts", { id: "a", state: "seen", evidence: [] }, agent)).rejects.toMatchObject({ code: "refused" });
    const slow = store(
      () => {
        const until = Date.now() + 5;
        while (Date.now() < until);
        return true;
      },
      log,
      1,
    );
    await slow.put("concepts", { id: "a", state: "seen", evidence: [] }, agent);
    expect(log.some((m) => /rules of "concepts" took \d+ ms/.test(m))).toBe(true);
  });
});
