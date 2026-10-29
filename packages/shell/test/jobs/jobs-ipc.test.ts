import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type HarnessJob, jobSchema } from "@humanharness/harness-sdk";
import type { HarnessWorkspace } from "@humanharness/runtime";
import { JobLog, type JobRunRecord } from "../../src/main/jobs/job-log";
import { type JobsHostDeps, coalescedSender, createJobsHost, jobsInfo, jobsIpc, singleGate } from "../../src/main/jobs/jobs-host";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-jobs-ipc-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let n = 0;
const freshBase = () => fs.mkdtempSync(path.join(root, `b${++n}-`));

const job = (o: Record<string, unknown> = {}): HarnessJob => jobSchema.parse({ label: "Sync", prompt: "jobs/sync.md", on: { manual: true }, scope: "each", ...o });

/** A jobs host whose runs never reach an engine: its workspace waits until the test stops the host. */
function host(o: { jobs?: Record<string, HarnessJob>; deps?: Partial<JobsHostDeps> } = {}) {
  const base = freshBase();
  const armed: number[] = [];
  const h = createJobsHost({
    jobs: o.jobs ?? { sync: job() },
    actions: { implement: { label: "Implement" } },
    readBrief: async () => "Sync the inbox.",
    workspace: () => new Promise<HarnessWorkspace>(() => {}),
    gate: singleGate("claude", undefined),
    base: async () => base,
    taskDeps: { notes: async () => [] },
    scoped: () => true,
    scopes: async () => ["physics", "chemistry"],
    scopeExists: async (s) => s === "physics" || s === "chemistry",
    engine: async () => "claude",
    usage: async () => {},
    report: () => {},
    timer: { set: (_fn, ms) => armed.push(ms), clear: () => {} },
    now: () => new Date("2026-10-28T10:00:00Z"),
    ...o.deps,
  });
  return { h, base, ipc: jobsIpc(() => h) };
}

const record = (o: Partial<JobRunRecord>): JobRunRecord => ({
  run: "r1",
  job: "sync",
  scope: null,
  trigger: "manual",
  status: "ok",
  summary: "All synced",
  tokens: 10,
  startedAt: "2026-10-28T09:00:00.000Z",
  endedAt: "2026-10-28T09:01:00.000Z",
  ...o,
});

describe("jobsIpc (parallel spec §9.1, J4)", () => {
  it("D0: without jobs every channel refuses with No jobs", async () => {
    const ipc = jobsIpc(() => null);
    await expect(ipc.list()).rejects.toThrow("No jobs");
    await expect(ipc.run("sync", undefined)).rejects.toThrow("No jobs");
  });

  it("run refuses an unknown id, an inherited name, and an id that is not 1..200 characters", async () => {
    const { ipc, h } = host({ jobs: { sync: job({ scope: "none" }) } });
    await expect(ipc.run("nope", undefined)).rejects.toThrow("Unknown job");
    await expect(ipc.run("toString", undefined)).rejects.toThrow("Unknown job");
    await expect(ipc.run("x".repeat(201), undefined)).rejects.toThrow("Invalid job");
    await expect(ipc.run("", undefined)).rejects.toThrow("Invalid job");
    await expect(ipc.run(42, undefined)).rejects.toThrow("Invalid job");
    expect(h.scheduler.isActive("sync", null)).toBe(false);
  });

  it("run refuses a job that isn't manual, and a job turned off in Settings › Jobs", async () => {
    const { ipc } = host({
      jobs: { nightly: job({ on: { start: true } }), sync: job({ scope: "none" }) },
      deps: { settings: (id) => (id === "sync" ? { off: true } : undefined) },
    });
    await expect(ipc.run("nightly", "physics")).rejects.toThrow("not run by hand");
    await expect(ipc.run("sync", undefined)).rejects.toThrow("The job is off");
  });

  it("run refuses a scope that doesn't exist, a scope that isn't a string, and a scope on an app-wide job", async () => {
    const { ipc, h } = host({ jobs: { sync: job(), app: job({ scope: "none" }) } });
    await expect(ipc.run("sync", "biology")).rejects.toThrow("Unknown scope");
    await expect(ipc.run("sync", 7)).rejects.toThrow("Invalid scope");
    await expect(ipc.run("sync", "y".repeat(201))).rejects.toThrow("Invalid scope");
    await expect(ipc.run("app", "physics")).rejects.toThrow("has no scope");
    expect(h.scheduler.isActive("sync", "biology")).toBe(false);
    expect(h.scheduler.isActive("app", null)).toBe(false);
  });

  it("run refuses a scope-trigger job without a scope", async () => {
    const { ipc } = host({ jobs: { sync: job({ scope: "trigger" }) } });
    await expect(ipc.run("sync", undefined)).rejects.toThrow("needs a scope");
  });

  it("run starts a declared manual job in an existing scope, and answers false while it is already queued", async () => {
    const { ipc, h } = host();
    expect(await ipc.run("sync", "physics")).toBe(true);
    expect(h.scheduler.isActive("sync", "physics")).toBe(true);
    expect(h.scheduler.isActive("sync", "chemistry")).toBe(false);
    expect(await ipc.run("sync", "physics")).toBe(false);
    h.stopAll();
  });

  it("list answers each job × active scope, with its last run, running, manual and the label", async () => {
    const { ipc, h, base } = host({ jobs: { sync: job(), app: job({ label: "Tidy", scope: "none", on: { start: true } }) } });
    const log = new JobLog(base);
    await log.append(record({ run: "a", scope: "physics", status: "needs-you", summary: "Pick a topic", action: "implement" }));
    await log.append(record({ run: "b", job: "app", scope: null, status: "failed", summary: "No result" }));
    // An archived scope's run doesn't show (as needsYou() doesn't count it).
    await log.append(record({ run: "c", scope: "biology" }));
    expect(await ipc.run("sync", "chemistry")).toBe(true);
    expect(await ipc.list()).toEqual([
      {
        id: "sync",
        label: "Sync",
        scope: "physics",
        last: { status: "needs-you", summary: "Pick a topic", at: "2026-10-28T09:01:00.000Z", action: "implement" },
        manual: true,
        running: false,
      },
      { id: "sync", label: "Sync", scope: "chemistry", manual: true, running: true },
      { id: "app", label: "Tidy", scope: null, last: { status: "failed", summary: "No result", at: "2026-10-28T09:01:00.000Z" }, manual: false, running: false },
    ]);
    h.stopAll();
  });

  it("list says paused off for a job turned off, daily-cap for an every job over its cap, and next for an armed timer", async () => {
    const { ipc, h, base } = host({
      jobs: {
        hourly: job({ label: "Hourly", scope: "none", on: { every: "1h" }, dailyTokens: 100 }),
        daily: job({ label: "Daily", scope: "none", on: { every: "1h" }, dailyTokens: 1000 }),
        sync: job({ scope: "none" }),
      },
      deps: { settings: (id) => (id === "sync" ? { off: true } : undefined) },
    });
    await new JobLog(base).append(record({ job: "hourly", tokens: 150, startedAt: "2026-10-28T09:30:00.000Z" }));
    await h.appReady();
    const rows = await ipc.list();
    expect(rows.find((r) => r.id === "hourly")).toMatchObject({ paused: "daily-cap" });
    expect(rows.find((r) => r.id === "hourly")?.next).toBeUndefined();
    expect(rows.find((r) => r.id === "daily")).toMatchObject({ next: "2026-10-28T11:00:00.000Z" });
    expect(rows.find((r) => r.id === "daily")?.paused).toBeUndefined();
    expect(rows.find((r) => r.id === "sync")).toMatchObject({ paused: "off", manual: true });
    h.stopAll();
  });

  it("run before setup answers false: there is no folder for the run yet, so nothing is queued", async () => {
    const { ipc, h } = host({ jobs: { sync: job({ scope: "none" }) }, deps: { base: async () => null } });
    expect(await ipc.run("sync", undefined)).toBe(false);
    expect(h.scheduler.isActive("sync", null)).toBe(false);
  });

  it("next moves one interval forward after the timer fires", async () => {
    let at = new Date("2026-10-28T10:00:00Z");
    const fires: (() => void)[] = [];
    const { ipc, h } = host({
      jobs: { daily: job({ label: "Daily", scope: "none", on: { every: "1h" }, dailyTokens: 1000 }) },
      deps: { now: () => at, timer: { set: (fn) => fires.push(fn), clear: () => {} } },
    });
    await h.appReady();
    expect((await ipc.list())[0].next).toBe("2026-10-28T11:00:00.000Z");
    at = new Date("2026-10-28T11:00:00Z");
    fires.at(-1)!();
    expect((await ipc.list())[0].next).toBe("2026-10-28T12:00:00.000Z");
    h.stopAll();
  });

  it("list before setup: app-wide rows only, no last run", async () => {
    const { ipc } = host({ jobs: { sync: job(), app: job({ scope: "none" }) }, deps: { base: async () => null, scopes: async () => [] } });
    expect(await ipc.list()).toEqual([{ id: "app", label: "Sync", scope: null, manual: true, running: false }]);
  });

  it("the host's changed() is called when a run is queued (main sends hh:jobsChange)", async () => {
    let changed = 0;
    const { ipc, h } = host({ deps: { changed: () => void changed++ } });
    await ipc.run("sync", "physics");
    expect(changed).toBeGreaterThan(0);
    h.stopAll();
  });
});

describe("jobsInfo (AppState.jobs)", () => {
  it("D0: undefined without jobs, or with an empty jobs object", () => {
    expect(jobsInfo({})).toBeUndefined();
    expect(jobsInfo({ jobs: {} })).toBeUndefined();
  });

  it("names each declared job: label, every and daily cap when set, manual; never its brief", () => {
    const info = jobsInfo({ jobs: { hourly: job({ label: "Hourly", on: { every: "1h" }, dailyTokens: 100 }), sync: job({ on: { start: true } }) } });
    expect(info).toEqual({
      jobs: [
        { id: "hourly", label: "Hourly", every: "1h", dailyTokens: 100, manual: false },
        { id: "sync", label: "Sync", manual: false },
      ],
    });
    expect(JSON.stringify(info)).not.toContain("jobs/sync.md");
  });
});

describe("coalescedSender (hh:jobsChange)", () => {
  const tick = () => Promise.resolve();

  it("a call while a read is under way, even in its last microtasks, gets one more read: the newest value is sent last", async () => {
    let version = 0;
    const sent: number[] = [];
    const push = coalescedSender(async () => ++version, (v) => void sent.push(v), () => {});
    push();
    await tick();
    await tick();
    push();
    for (let i = 0; i < 20; i++) await tick();
    expect(sent).toEqual([1, 2]);
  });

  it("at any point of the first push, a second call is never lost", async () => {
    for (let gap = 0; gap < 10; gap++) {
      let version = 0;
      const sent: number[] = [];
      const push = coalescedSender(async () => ++version, (v) => void sent.push(v), () => {});
      push();
      for (let i = 0; i < gap; i++) await tick();
      push();
      for (let i = 0; i < 30; i++) await tick();
      expect(sent.at(-1)).toBe(version);
      expect(version).toBe(2);
    }
  });

  it("reads never overlap, and calls during one read make a single more", async () => {
    let release!: () => void;
    let reads = 0;
    const sent: number[] = [];
    const push = coalescedSender(
      () => new Promise<number>((r) => { reads++; release = () => r(reads); }),
      (v) => void sent.push(v),
      () => {},
    );
    push();
    push();
    push();
    expect(reads).toBe(1);
    release();
    for (let i = 0; i < 10; i++) await tick();
    expect(reads).toBe(2);
    release();
    for (let i = 0; i < 10; i++) await tick();
    expect(sent).toEqual([1, 2]);
  });

  it("a failed read is reported and the next call reads again", async () => {
    const errors: unknown[] = [];
    let fail = true;
    const sent: string[] = [];
    const push = coalescedSender(async () => { if (fail) throw new Error("boom"); return "ok"; }, (v) => void sent.push(v), (e) => void errors.push(e));
    push();
    for (let i = 0; i < 10; i++) await tick();
    fail = false;
    push();
    for (let i = 0; i < 10; i++) await tick();
    expect(errors).toHaveLength(1);
    expect(sent).toEqual(["ok"]);
  });
});
