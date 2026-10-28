import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { jobsFile } from "@humanharness/workspace";
import { JobLog, type JobRunRecord, dedupeKey } from "../../src/main/jobs/job-log";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-joblog-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const rec = (extra: Partial<JobRunRecord>): JobRunRecord => ({
  run: "r",
  job: "sync",
  scope: "main",
  trigger: "every",
  status: "ok",
  summary: "x",
  tokens: 100,
  startedAt: "2026-10-28T09:00:00",
  endedAt: "2026-10-28T09:01:00",
  ...extra,
});

describe("JobLog (parallel spec §8, J5)", () => {
  it("lives at .harness/jobs.jsonl", () => {
    expect(jobsFile("/b")).toBe(path.join("/b", ".harness", "jobs.jsonl"));
  });
  it("appends runs and reads the last per job and scope", async () => {
    const log = new JobLog(fs.mkdtempSync(path.join(root, "b-")));
    await log.append(rec({ run: "1", summary: "first" }));
    await log.append(rec({ run: "2", summary: "second" }));
    await log.append(rec({ run: "3", scope: "s2" }));
    const last = await log.lastRuns();
    expect(last.get("sync:main")?.summary).toBe("second");
    expect(last.get("sync:s2")?.run).toBe("3");
    expect(last.size).toBe(2);
  });
  it("appends in call order even without awaiting each one", async () => {
    const log = new JobLog(fs.mkdtempSync(path.join(root, "b-")));
    await Promise.all(["1", "2", "3", "4"].map((run) => log.append(rec({ run }))));
    expect((await log.all()).map((r) => r.run)).toEqual(["1", "2", "3", "4"]);
  });
  it("tokens today count only that job's runs that started today (local day, Decision 9)", async () => {
    const log = new JobLog(fs.mkdtempSync(path.join(root, "b-")));
    await log.append(rec({ tokens: 100 }));
    await log.append(rec({ tokens: 50, startedAt: "2026-10-27T23:00:00" }));
    await log.append(rec({ job: "other", tokens: 999 }));
    expect(await log.tokensToday("sync", new Date("2026-10-28T12:00:00"))).toBe(100);
    expect(await log.tokensToday("sync", new Date("2026-10-27T08:00:00"))).toBe(50);
    expect(await log.tokensToday("none", new Date("2026-10-28T12:00:00"))).toBe(0);
  });
  it("a corrupt or malformed line is skipped", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    const log = new JobLog(base);
    await log.append(rec({}));
    fs.appendFileSync(jobsFile(base), '{nope\n{"job":"sync"}\n[]\nnull\n');
    expect((await log.all()).length).toBe(1);
    expect((await log.lastRuns()).size).toBe(1);
  });
  it("a torn last line does not swallow the next run (J5: the daily cap still counts it)", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    const log = new JobLog(base);
    await log.append(rec({ run: "1", tokens: 100 }));
    fs.appendFileSync(jobsFile(base), '{"run":"torn","job":"sy');
    await log.append(rec({ run: "2", tokens: 5000 }));
    expect((await log.all()).map((r) => r.run)).toEqual(["1", "2"]);
    expect(await log.tokensToday("sync", new Date("2026-10-28T12:00:00"))).toBe(5100);
  });
  it("a line with a wrong field type, an unknown status or trigger, or negative tokens is skipped", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    const log = new JobLog(base);
    await log.append(rec({ run: "ok" }));
    const bad = [{ tokens: -1 }, { status: "maybe" }, { trigger: "cron" }, { summary: 3 }, { run: 1 }, { endedAt: null }, { action: 5 }];
    fs.appendFileSync(jobsFile(base), bad.map((b) => JSON.stringify({ ...rec({}), ...b })).join("\n") + "\n");
    expect((await log.all()).map((r) => r.run)).toEqual(["ok"]);
  });
  it("D0: reading a missing log is empty and creates nothing", async () => {
    const base = fs.mkdtempSync(path.join(root, "b-"));
    const log = new JobLog(base);
    expect((await log.lastRuns()).size).toBe(0);
    expect(await log.tokensToday("sync", new Date())).toBe(0);
    expect(fs.existsSync(path.join(base, ".harness"))).toBe(false);
  });
  it("dedupeKey is job:scope", () => {
    expect(dedupeKey("sync", "main")).toBe("sync:main");
    expect(dedupeKey("sync", null)).toBe("sync:-");
  });
});
