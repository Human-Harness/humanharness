import { describe, expect, it } from "vitest";
import { type HarnessJob, jobSchema, z } from "@humanharness/harness-sdk";
import type { JobRunRecord, JobTrigger } from "../../src/main/jobs/job-log";
import { JobScheduler } from "../../src/main/jobs/job-scheduler";

const MIN = 60_000;
const DAY0 = new Date(2026, 9, 28, 9, 0, 0).getTime();
const output = z.object({ ids: z.array(z.string()) });

const promptJob = (): HarnessJob => jobSchema.parse({ label: "Sync", prompt: "jobs/sync.md", on: { every: "15m" }, dailyTokens: 1000 });
const noAiRecipe = (): HarnessJob => jobSchema.parse({ label: "Tidy", on: { every: "15m" }, scope: "none", steps: [{ tool: "tidy" }] });
const aiRecipe = (): HarnessJob =>
  jobSchema.parse({
    label: "Triage",
    on: { every: "15m" },
    scope: "none",
    dailyTokens: 1000,
    steps: [{ tool: "pr-ci", as: "ci" }, { ai: "jobs/triage.md", input: ["ci"], output, as: "triage" }, { tool: "apply-triage", input: ["triage"] }],
  });

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

/**
 * A scheduler over fakes, as job-scheduler.test.ts builds it: a fake clock and one-shot timers, `tokens` today for
 * every job, a run double that ends at once.
 */
function setup(jobs: Record<string, HarnessJob>, tokens: number, settings: Record<string, { dailyTokens?: number }> = {}) {
  let now = DAY0;
  let seq = 0;
  const armed = new Map<number, { at: number; fn: () => void }>();
  const runs: { id: string; trigger: JobTrigger }[] = [];
  const lines: string[] = [];
  const s = new JobScheduler({
    jobs,
    log: { tokensToday: async () => tokens },
    run: async (id, _job, scope, trigger) => {
      runs.push({ id, trigger });
      return { run: `r${runs.length}`, job: id, scope, trigger, status: "ok", summary: "Done", tokens: 0, startedAt: "", endedAt: "" } as JobRunRecord;
    },
    scopes: async () => ["main"],
    scopeExists: async (sc) => sc === "main",
    settings: (id) => settings[id] ?? {},
    timer: {
      set(fn: () => void, ms: number) {
        armed.set(++seq, { at: now + ms, fn });
        return seq;
      },
      clear(h: unknown) {
        armed.delete(h as number);
      },
    },
    now: () => new Date(now),
    report: (m) => void lines.push(m),
    changed: () => {},
  });
  const advance = async (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...armed.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      armed.delete(next[0]);
      now = next[1].at;
      next[1].fn();
      await flush();
    }
    now = end;
    await flush();
  };
  return { s, runs, lines, advance };
}

describe("the daily cap and jobs that use no AI (tools spec §7.4)", () => {
  it("D0: a job that uses AI is paused at its cap as before", async () => {
    const t = setup({ sync: promptJob() }, 1000);
    await t.s.appReady();
    await t.advance(15 * MIN);
    expect(t.runs).toEqual([]);
    expect(await t.s.pausedToday("sync")).toBe(true);
    expect(t.lines).toEqual(["Job sync: daily cap reached, every skipped"]);
  });

  it("D0: under its cap a job that uses AI runs", async () => {
    const t = setup({ sync: promptJob() }, 999);
    await t.s.appReady();
    await t.advance(15 * MIN);
    expect(t.runs).toEqual([{ id: "sync", trigger: "every" }]);
    expect(await t.s.pausedToday("sync")).toBe(false);
  });

  it("an every recipe with no AI step and no dailyTokens is never paused", async () => {
    const t = setup({ tidy: noAiRecipe() }, 0);
    await t.s.appReady();
    await t.advance(15 * MIN);
    expect(t.runs).toEqual([{ id: "tidy", trigger: "every" }]);
    expect(await t.s.pausedToday("tidy")).toBe(false);
  });

  it("an every recipe with no AI step is not paused by a cap set in Settings › Jobs either", async () => {
    const t = setup({ tidy: noAiRecipe() }, 5000, { tidy: { dailyTokens: 10 } });
    await t.s.appReady();
    await t.advance(15 * MIN);
    expect(t.runs).toEqual([{ id: "tidy", trigger: "every" }]);
    expect(await t.s.pausedToday("tidy")).toBe(false);
    expect(t.lines).toEqual([]);
  });

  it("an every recipe with an AI step is paused at its cap", async () => {
    const t = setup({ triage: aiRecipe() }, 1000);
    await t.s.appReady();
    await t.advance(15 * MIN);
    expect(t.runs).toEqual([]);
    expect(await t.s.pausedToday("triage")).toBe(true);
  });
});
