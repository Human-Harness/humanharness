import { describe, expect, it } from "vitest";
import { type UsageRecord, dayTokens, jobRecord, recentUsage, recipeRecord, summarizeUsage, usageRecord } from "../../src/main/usage-log";

const AT = "2026-10-29T10:00:00.000Z";
const usage = { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("recipeRecord (tools spec §8.4)", () => {
  it("is { at, engine, phase: 'job', kind: 'recipe', job, task: run, run, scope?, toolSteps, aiSteps, ms, ok }", () => {
    expect(recipeRecord({ engine: "claude", job: "sync", run: "r1", scope: "intro", toolSteps: 3, aiSteps: 1, ms: 420, ok: true }, AT)).toStrictEqual({
      at: AT,
      engine: "claude",
      phase: "job",
      kind: "recipe",
      job: "sync",
      task: "r1",
      run: "r1",
      scope: "intro",
      toolSteps: 3,
      aiSteps: 1,
      ms: 420,
      ok: true,
    });
  });

  it("an app-wide run has no scope key, and no usage", () => {
    const r = recipeRecord({ engine: "claude", job: "sync", run: "r1", toolSteps: 2, aiSteps: 0, ms: 5, ok: false }, AT);
    expect(Object.hasOwn(r, "scope")).toBe(false);
    expect(Object.hasOwn(r, "usage")).toBe(false);
    expect(r.ok).toBe(false);
  });

  it("a recipe row is a job line for the readers: recentUsage keeps it with the job lines, dayTokens and summarizeUsage count nothing from it", () => {
    const task = usageRecord({ role: "assistant", text: "", usage } as never, "claude", { task: "t1", action: "draft" });
    const records: UsageRecord[] = [
      task!,
      jobRecord({ engine: "claude", job: "sync", task: "r1", usage }, AT),
      recipeRecord({ engine: "claude", job: "sync", run: "r1", toolSteps: 3, aiSteps: 1, ms: 420, ok: true }, AT),
    ].map((r) => ({ ...r, at: AT }));
    // The last n lines that aren't a job's, with every job line after them: the recipe row is kept, as a job line.
    expect(recentUsage(records, 1)).toEqual(records);
    const day = dayTokens(records, "2026-10-29", (d) => d.toISOString().slice(0, 10));
    // The job's tokens are its AI step's usage line alone (120); the recipe row adds nothing.
    expect(day.jobs).toBe(120);
    const without = records.slice(0, 2);
    expect(summarizeUsage(records, undefined, new Date(AT))).toEqual(summarizeUsage(without, undefined, new Date(AT)));
  });
});
