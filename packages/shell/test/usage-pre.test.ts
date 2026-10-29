import { describe, expect, it } from "vitest";
import { type UsageRecord, expectsMissRecord, preRecord, recentUsage, summarizeUsage } from "../src/main/usage-log";

const R1 = "2026-10-29T15:00:00.000Z";
const WEEK = "2026-11-02T09:00:00.000Z";
const NOW = new Date("2026-10-29T10:30:00.000Z");
const usage = (input: number) => ({ inputTokens: input, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 });
const turn = (u: number, o: Partial<UsageRecord> = {}): UsageRecord => ({
  at: "2026-10-29T10:00:00.000Z",
  engine: "claude",
  ok: true,
  limits: [
    { kind: "five_hour", utilization: u, resetsAt: R1 },
    { kind: "seven_day", utilization: 0.05, resetsAt: WEEK },
  ],
  ...o,
});
const d0Log: UsageRecord[] = [
  turn(0.1, { action: "study", task: "a", scope: "intro", phase: "run", usage: usage(100) }),
  turn(0.15, { action: "study", task: "a", scope: "intro", phase: "run", usage: usage(200) }),
  { at: "2026-10-29T10:01:00.000Z", engine: "claude", action: "study", task: "a", scope: "intro", kind: "compaction", ok: true },
  turn(0.2, { action: "study", task: "a", scope: "intro", phase: "close", usage: usage(50) }),
  turn(0.22, { action: "quiz", task: "b", scope: "intro", phase: "run", usage: usage(300) }),
  turn(0.3, { task: "r1", phase: "job", job: "digest", usage: usage(400) }),
  turn(0.32, { task: "c", phase: "run", usage: usage(70) }),
  turn(0.4, { action: "quiz", task: "d", scope: "_app", phase: "run", usage: usage(80) }),
];

/** summarizeUsage(d0Log) as recorded before pre and expects-miss rows existed (Task 9). */
const D0_SUMMARY = {
  limits: [
    { kind: "five_hour", utilization: 0.4, resetsAt: R1 },
    { kind: "seven_day", utilization: 0.05, resetsAt: WEEK },
  ],
  estimates: { study: 0.1, questions: 0.08000000000000002 },
  tokens: { study: 320, quiz: 200, questions: 80 },
  scopes: { intro: 690, _app: 90 },
  jobs: 410,
  primary: "five_hour",
};

const AT = "2026-10-29T10:00:00.000Z";
const pre = preRecord({ engine: "claude", action: "study", task: "b", scope: "intro", steps: 2, ms: 412, preparedTokens: 830, ok: true }, AT);
const miss = expectsMissRecord({ engine: "claude", action: "study", task: "a", scope: "intro", taskPhase: "close", tool: "apply-evidence" }, AT);

describe("pre and expects rows (tools spec §8.4)", () => {
  it("preRecord: kind pre with action, task, scope, steps, ms, preparedTokens, ok", () => {
    expect(preRecord({ engine: "claude", action: "study", task: "t1", scope: "intro", steps: 2, ms: 412, preparedTokens: 830, ok: true }, AT)).toEqual({
      at: AT, engine: "claude", kind: "pre", action: "study", task: "t1", scope: "intro", steps: 2, ms: 412, preparedTokens: 830, ok: true,
    });
  });

  it("preRecord: no scope key without a scope, and ok false when a step failed", () => {
    const r = preRecord({ engine: "codex", action: "study", task: "t1", steps: 1, ms: 9, preparedTokens: 0, ok: false }, AT);
    expect(r).toEqual({ at: AT, engine: "codex", kind: "pre", action: "study", task: "t1", steps: 1, ms: 9, preparedTokens: 0, ok: false });
    expect("scope" in r).toBe(false);
  });

  it("expectsMissRecord: kind expects-miss with taskPhase and tool", () => {
    expect(expectsMissRecord({ engine: "claude", action: "study", task: "t1", taskPhase: "close", tool: "apply-evidence" }, AT)).toEqual({
      at: AT, engine: "claude", kind: "expects-miss", action: "study", task: "t1", taskPhase: "close", tool: "apply-evidence", ok: true,
    });
    expect(miss.scope).toBe("intro");
  });

  it("the rows carry no usage, limits or turn kind", () => {
    for (const r of [pre, miss]) {
      expect(r.usage).toBeUndefined();
      expect(r.limits).toBeUndefined();
      expect(r.phase).toBeUndefined();
    }
  });

  it("D0: a log without pre or expects rows summarises as before", () => {
    expect(summarizeUsage(d0Log, "five_hour", NOW)).toEqual(D0_SUMMARY);
  });

  it("a pre row between two tasks' turns leaves both measured", () => {
    // Task a's last run turn, then task b's pre row (no limits), then b's first turn.
    const log = [d0Log[0], d0Log[1], pre, turn(0.3, { action: "quiz", task: "b", scope: "intro", phase: "run", usage: usage(5) })];
    const without = summarizeUsage(log.filter((r) => r !== pre), "five_hour", NOW);
    const withPre = summarizeUsage(log, "five_hour", NOW);
    expect(withPre).toEqual(without);
    expect(withPre.estimates.study).toBeCloseTo(0.2);
    // The pre row adds no scope total of its own.
    expect(withPre.scopes).toEqual({ intro: 335 });
  });

  it("a pre row as a task's only line makes no task of it", () => {
    const s = summarizeUsage([pre], "five_hour", NOW);
    expect(s).toEqual({ limits: null, estimates: {}, tokens: {}, primary: "five_hour" });
  });

  it("an expects-miss row is not a turn: no task, scope or token total changes", () => {
    const log = [...d0Log.slice(0, 2), miss, ...d0Log.slice(2), { ...miss, task: "c", scope: "other", action: undefined }];
    expect(summarizeUsage(log, "five_hour", NOW)).toEqual(D0_SUMMARY);
  });

  it("pre and expects-miss rows among the D0 log summarise as the D0 log", () => {
    const log = d0Log.flatMap((r, i) => (i % 2 ? [r, pre] : [miss, r]));
    expect(summarizeUsage(log, "five_hour", NOW)).toEqual(D0_SUMMARY);
  });

  it("recentUsage counts pre rows like other non-job lines", () => {
    // pre and expects-miss rows are not job lines: each counts toward n.
    const job = turn(0.5, { task: "r2", phase: "job", job: "digest" });
    const log = [d0Log[0], pre, job, miss];
    expect(recentUsage(log, 2)).toEqual([pre, job, miss]);
    expect(recentUsage(log, 3)).toEqual(log);
  });
});
