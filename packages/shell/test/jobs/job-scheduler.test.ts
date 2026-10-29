import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type HarnessJob, jobSchema } from "@humanharness/harness-sdk";
import { JobLog, type JobRunRecord, type JobTrigger } from "../../src/main/jobs/job-log";
import { JobScheduler, type SchedulerDeps, TIMER_MAX_MS } from "../../src/main/jobs/job-scheduler";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-jobsched-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
const freshBase = () => fs.mkdtempSync(path.join(root, `b${++n}-`));

const job = (o: Record<string, unknown>): HarnessJob => jobSchema.parse({ label: "Sync", prompt: "jobs/sync.md", ...o });

const MIN = 60_000;
const DAY0 = new Date(2026, 9, 28, 9, 0, 0).getTime();

/** A fake clock and one-shot timers: `advance` moves the clock and fires every timer due, in order. */
function fakeTimers() {
  let now = DAY0;
  let seq = 0;
  const armed = new Map<number, { at: number; ms: number; fn: () => void }>();
  const delays: number[] = [];
  return {
    now: () => new Date(now),
    timer: {
      set(fn: () => void, ms: number) {
        delays.push(ms);
        armed.set(++seq, { at: now + ms, ms, fn });
        return seq;
      },
      clear(h: unknown) {
        armed.delete(h as number);
      },
    },
    armed,
    delays,
    async advance(ms: number) {
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
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise<void>((r) => setImmediate(r));
};

interface Call {
  id: string;
  scope: string | null;
  trigger: JobTrigger;
  signal: AbortSignal;
  finish(r?: Partial<JobRunRecord> | null): void;
}

/** A scheduler over fakes: `run` records each call and resolves when its `finish` is called. */
function setup(jobs: Record<string, HarnessJob>, o: { scopes?: string[]; settings?: Record<string, { off?: boolean; dailyTokens?: number }>; base?: string } = {}) {
  const t = fakeTimers();
  const calls: Call[] = [];
  const lines: string[] = [];
  let changes = 0;
  const log = new JobLog(o.base ?? freshBase());
  const scopes = o.scopes ?? ["main"];
  const deps: SchedulerDeps = {
    jobs,
    log,
    run: (id, _job, scope, trigger, signal) =>
      new Promise((resolve) => {
        calls.push({
          id,
          scope,
          trigger,
          signal,
          finish: (r) => resolve(r === null ? null : ({ run: `r${calls.length}`, job: id, scope, trigger, status: "ok", summary: "Done", tokens: 0, startedAt: "", endedAt: "", ...r } as JobRunRecord)),
        });
      }),
    scopes: async () => [...scopes],
    scopeExists: async (s) => scopes.includes(s),
    settings: (id) => o.settings?.[id] ?? {},
    timer: t.timer,
    now: t.now,
    report: (m) => void lines.push(m),
    changed: () => void changes++,
  };
  const s = new JobScheduler(deps);
  return { s, t, calls, lines, log, deps, changes: () => changes };
}

const record = (job: string, tokens: number, startedAt: Date): JobRunRecord => ({
  run: `x-${tokens}`,
  job,
  scope: null,
  trigger: "every",
  status: "ok",
  summary: "Done",
  tokens,
  startedAt: startedAt.toISOString(),
  endedAt: startedAt.toISOString(),
});

describe("JobScheduler (parallel spec §8)", () => {
  it("D0: no jobs, no timers and no runs", async () => {
    const { s, t, calls } = setup({});
    await s.appReady();
    s.taskClosed({ id: "t1", action: "a", scope: "main" });
    expect(await s.manual("nope")).toBe(false);
    expect(t.delays).toEqual([]);
    expect(calls).toEqual([]);
    s.stopAll();
  });

  it("start: once per app start, one run per active scope for scope each (Decision 7)", async () => {
    const { s, calls } = setup(
      { boot: job({ on: { start: true } }), each: job({ on: { start: true }, scope: "each" }), later: job({ on: { manual: true } }) },
      { scopes: ["alpha", "beta"] },
    );
    await s.appReady();
    await flush();
    expect(calls.map((c) => [c.id, c.scope, c.trigger])).toEqual([
      ["boot", null, "start"],
      ["each", "alpha", "start"],
      ["each", "beta", "start"],
    ]);
    for (const c of calls) c.finish();
    await flush();
    await s.appReady();
    await flush();
    expect(calls).toHaveLength(3);
    s.stopAll();
  });

  it("appReady returns while the start runs are still running", async () => {
    const { s, calls } = setup({ boot: job({ on: { start: true } }) });
    await s.appReady();
    expect(calls).toHaveLength(1);
    expect(s.isActive("boot", null)).toBe(true);
    calls[0].finish();
    await flush();
    expect(s.isActive("boot", null)).toBe(false);
    s.stopAll();
  });

  it("manual: run(id, scope) only for a manual job and an existing scope (J4)", async () => {
    const { s, calls } = setup(
      {
        sync: job({ on: { manual: true } }),
        boot: job({ on: { start: true } }),
        per: job({ on: { manual: true }, scope: "each" }),
        trig: job({ on: { manual: true }, scope: "trigger" }),
      },
      { scopes: ["alpha", "beta"] },
    );
    expect(await s.manual("nope")).toBe(false);
    expect(await s.manual("toString")).toBe(false);
    expect(await s.manual("__proto__")).toBe(false);
    expect(await s.manual("boot")).toBe(false);
    expect(await s.manual("per", "gamma")).toBe(false);
    expect(await s.manual("sync", "gamma")).toBe(false);
    // An app-wide job takes no scope, an existing one neither (as the window's jobs.run refuses it).
    expect(await s.manual("sync", "alpha")).toBe(false);
    // scope "trigger" runs only in the scope it was asked for.
    expect(await s.manual("trig")).toBe(false);
    expect(calls).toEqual([]);

    expect(await s.manual("sync")).toBe(true);
    expect(await s.manual("per", "beta")).toBe(true);
    expect(await s.manual("trig", "alpha")).toBe(true);
    expect(calls.map((c) => [c.id, c.scope, c.trigger])).toEqual([
      ["sync", null, "manual"],
      ["per", "beta", "manual"],
      ["trig", "alpha", "manual"],
    ]);
    // Without a scope, a scope-each job runs in every active scope.
    for (const c of calls) c.finish();
    await flush();
    expect(await s.manual("per")).toBe(true);
    expect(calls.slice(3).map((c) => c.scope)).toEqual(["alpha", "beta"]);
    s.stopAll();
  });

  it("a job turned off in Settings › Jobs never runs, from any trigger", async () => {
    const { s, t, calls } = setup(
      { off: job({ on: { start: true, manual: true, afterTask: true, every: "30m" }, dailyTokens: 1000 }) },
      { settings: { off: { off: true } } },
    );
    await s.appReady();
    expect(await s.manual("off")).toBe(false);
    s.taskClosed({ id: "t1", scope: "main" });
    await t.advance(60 * MIN);
    expect(calls).toEqual([]);
    s.stopAll();
  });

  it("afterTask: a closed task of a listed action triggers; true means any action; scope trigger uses the task's scope", async () => {
    const { s, calls } = setup(
      {
        any: job({ on: { afterTask: true } }),
        listed: job({ on: { afterTask: ["review"] }, scope: "trigger" }),
        each: job({ on: { afterTask: ["review"] }, scope: "each" }),
        never: job({ on: { manual: true } }),
      },
      { scopes: ["alpha", "beta"] },
    );
    s.taskClosed({ id: "t1", action: "write", scope: "alpha" });
    await flush();
    expect(calls.map((c) => [c.id, c.scope, c.trigger])).toEqual([["any", null, "afterTask"]]);
    calls[0].finish();
    await flush();
    s.taskClosed({ id: "t2", action: "review", scope: "beta" });
    await flush();
    expect(calls.slice(1).map((c) => [c.id, c.scope, c.trigger])).toEqual([
      ["any", null, "afterTask"],
      ["listed", "beta", "afterTask"],
      ["each", "alpha", "afterTask"],
      ["each", "beta", "afterTask"],
    ]);
    for (const c of calls) c.finish();
    await flush();
    // A free question (no action) triggers only `true`.
    s.taskClosed({ id: "t3", scope: "alpha" });
    await flush();
    expect(calls.slice(5).map((c) => c.id)).toEqual(["any"]);
    s.stopAll();
  });

  it("every: first run one interval after start, then every interval", async () => {
    const { s, t, calls } = setup({ tick: job({ on: { every: "30m" }, dailyTokens: 1000 }) });
    await s.appReady();
    expect(calls).toEqual([]);
    await t.advance(29 * MIN);
    expect(calls).toEqual([]);
    await t.advance(1 * MIN);
    expect(calls.map((c) => c.trigger)).toEqual(["every"]);
    calls[0].finish();
    await t.advance(30 * MIN);
    expect(calls).toHaveLength(2);
    calls[1].finish();
    await t.advance(30 * MIN);
    expect(calls).toHaveLength(3);
    expect(Math.max(...t.delays)).toBe(30 * MIN);
    s.stopAll();
  });

  it("every: a long interval is armed in steps no longer than setTimeout's longest delay", async () => {
    const { s, t, calls } = setup({ slow: job({ on: { every: "9999h" }, dailyTokens: 1000 }) });
    await s.appReady();
    expect(t.delays).toEqual([TIMER_MAX_MS]);
    await t.advance(9998 * 60 * MIN);
    expect(calls).toEqual([]);
    expect(Math.max(...t.delays)).toBeLessThanOrEqual(TIMER_MAX_MS);
    await t.advance(60 * MIN);
    expect(calls.map((c) => c.id)).toEqual(["slow"]);
    expect(Math.max(...t.delays)).toBeLessThanOrEqual(TIMER_MAX_MS);
    s.stopAll();
  });

  it("dedupe: a job and scope already queued or running is skipped and logged", async () => {
    const { s, t, calls, lines } = setup({ tick: job({ on: { every: "15m", manual: true }, dailyTokens: 1000 }) });
    await s.appReady();
    await t.advance(15 * MIN);
    expect(calls).toHaveLength(1);
    expect(s.isActive("tick", null)).toBe(true);
    // The run is still going: the next tick and a "Run now" are skipped.
    await t.advance(15 * MIN);
    expect(await s.manual("tick")).toBe(false);
    expect(calls).toHaveLength(1);
    expect(lines).toEqual(["Job tick:-: already queued or running, every skipped", "Job tick:-: already queued or running, manual skipped"]);
    calls[0].finish();
    await flush();
    expect(s.isActive("tick", null)).toBe(false);
    expect(await s.manual("tick")).toBe(true);
    expect(calls).toHaveLength(2);
    s.stopAll();
  });

  it("dedupe is per scope: another scope of the same job still runs", async () => {
    const { s, calls } = setup({ per: job({ on: { manual: true }, scope: "each" }) }, { scopes: ["alpha", "beta"] });
    expect(await s.manual("per", "alpha")).toBe(true);
    expect(await s.manual("per", "alpha")).toBe(false);
    expect(await s.manual("per", "beta")).toBe(true);
    expect(calls.map((c) => c.scope)).toEqual(["alpha", "beta"]);
    s.stopAll();
  });

  it("daily cap: every-runs stop once tokens today reach dailyTokens; manual still runs; summary says paused until tomorrow (J5)", async () => {
    const base = freshBase();
    const { s, t, calls, lines, log } = setup({ tick: job({ on: { every: "15m", manual: true }, dailyTokens: 1000 }) }, { base });
    // Yesterday's runs don't count.
    await log.append(record("tick", 5000, new Date(DAY0 - 24 * 60 * MIN)));
    await log.append(record("tick", 600, new Date(DAY0)));
    await s.appReady();
    expect(await s.pausedToday("tick")).toBe(false);
    await t.advance(15 * MIN);
    expect(calls).toHaveLength(1);
    calls[0].finish();
    await log.append(record("tick", 400, new Date(DAY0 + 15 * MIN)));
    expect(await s.pausedToday("tick")).toBe(true);
    await t.advance(15 * MIN);
    expect(calls).toHaveLength(1);
    expect(lines).toEqual(["Job tick: daily cap reached, every skipped"]);
    expect(await s.manual("tick")).toBe(true);
    expect(calls.map((c) => c.trigger)).toEqual(["every", "manual"]);
    calls[1].finish();
    // The next local day the cap starts again.
    await t.advance(24 * 60 * MIN);
    expect(await s.pausedToday("tick")).toBe(false);
    expect(calls.filter((c) => c.trigger === "every").length).toBeGreaterThan(1);
    s.stopAll();
  });

  it("daily cap: the person's cap from Settings › Jobs wins over the manifest's", async () => {
    const base = freshBase();
    const { s, log } = setup({ tick: job({ on: { every: "15m" }, dailyTokens: 1000 }) }, { base, settings: { tick: { dailyTokens: 5000 } } });
    await log.append(record("tick", 2000, new Date(DAY0)));
    expect(await s.pausedToday("tick")).toBe(false);
    await log.append(record("tick", 3000, new Date(DAY0)));
    expect(await s.pausedToday("tick")).toBe(true);
    s.stopAll();
  });

  it("pausedToday is false for a job without every and for an unknown id", async () => {
    const base = freshBase();
    const { s, log } = setup({ sync: job({ on: { manual: true }, dailyTokens: 1 }) }, { base });
    await log.append(record("sync", 50, new Date(DAY0)));
    expect(await s.pausedToday("sync")).toBe(false);
    expect(await s.pausedToday("nope")).toBe(false);
    expect(await s.pausedToday("constructor")).toBe(false);
  });

  it("stopAll cancels running runs and clears timers (engine switch, quit; Decision 11)", async () => {
    const { s, t, calls } = setup({ boot: job({ on: { start: true, manual: true } }), tick: job({ on: { every: "15m" }, dailyTokens: 1000 }) });
    await s.appReady();
    expect(calls).toHaveLength(1);
    expect(t.armed.size).toBe(1);
    s.stopAll();
    expect(calls[0].signal.aborted).toBe(true);
    expect(t.armed.size).toBe(0);
    calls[0].finish(null);
    await flush();
    expect(s.isActive("boot", null)).toBe(false);
    // Nothing fires after it: no timer, no trigger.
    await t.advance(60 * MIN);
    expect(await s.manual("boot")).toBe(false);
    s.taskClosed({ id: "t1", scope: "main" });
    await s.appReady();
    expect(calls).toHaveLength(1);
  });

  it("cancelRuns cancels the running runs but keeps the timers (engine switch)", async () => {
    const { s, t, calls } = setup({ boot: job({ on: { start: true } }), tick: job({ on: { every: "15m" }, dailyTokens: 1000 }) });
    await s.appReady();
    s.cancelRuns();
    expect(calls[0].signal.aborted).toBe(true);
    calls[0].finish(null);
    await t.advance(15 * MIN);
    expect(calls.map((c) => c.id)).toEqual(["boot", "tick"]);
    s.stopAll();
  });

  it("a run that throws is logged and frees its job and scope", async () => {
    const t = fakeTimers();
    const lines: string[] = [];
    const s = new JobScheduler({
      jobs: { sync: job({ on: { manual: true } }) },
      log: new JobLog(freshBase()),
      run: async () => {
        throw new Error("boom");
      },
      scopes: async () => ["main"],
      scopeExists: async () => true,
      settings: () => ({}),
      timer: t.timer,
      now: t.now,
      report: (m) => void lines.push(m),
      changed: () => {},
    });
    expect(await s.manual("sync")).toBe(true);
    await flush();
    expect(s.isActive("sync", null)).toBe(false);
    expect(lines).toEqual(["Job sync:- failed: boom"]);
    s.stopAll();
  });

  it("tells the window when a run starts and ends", async () => {
    const { s, calls, changes } = setup({ sync: job({ on: { manual: true } }) });
    expect(await s.manual("sync")).toBe(true);
    expect(changes()).toBe(1);
    calls[0].finish();
    await flush();
    expect(changes()).toBe(2);
    s.stopAll();
  });

  it("a run that throws before it returns a promise frees its job and scope; every keeps firing", async () => {
    const { t, lines, deps } = setup({ tick: job({ on: { every: "30m", manual: true }, dailyTokens: 1_000_000 }) });
    let runs = 0;
    const s = new JobScheduler({
      ...deps,
      run: () => {
        runs++;
        throw new Error("boom");
      },
    });
    await s.appReady();
    await t.advance(30 * MIN);
    expect(runs).toBe(1);
    expect(s.isActive("tick", null)).toBe(false);
    await t.advance(30 * MIN);
    expect(runs).toBe(2);
    expect(await s.manual("tick")).toBe(true);
    await flush();
    expect(runs).toBe(3);
    expect(lines.filter((l) => l.includes("boom"))).toHaveLength(3);
    s.stopAll();
  });

  it("a changed() that throws when a run ends is reported, not left unhandled", async () => {
    const { calls, lines, deps } = setup({ sync: job({ on: { manual: true } }) });
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => void unhandled.push(e);
    process.on("unhandledRejection", onUnhandled);
    let fail = false;
    const s = new JobScheduler({
      ...deps,
      changed: () => {
        if (fail) throw new Error("window gone");
      },
    });
    expect(await s.manual("sync")).toBe(true);
    fail = true;
    calls[0].finish();
    await flush();
    process.off("unhandledRejection", onUnhandled);
    expect(unhandled).toEqual([]);
    expect(s.isActive("sync", null)).toBe(false);
    expect(lines.some((l) => l.includes("window gone"))).toBe(true);
    s.stopAll();
  });
});
