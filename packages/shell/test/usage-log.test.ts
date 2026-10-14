import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ChatEntry } from "@humanharness/ui/client";
import { type UsageMeta, type UsageRecord, UsageLog, compactionRecord, profileMeta, summarizeUsage, usageRecord } from "../src/main/usage-log";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const R1 = "2026-10-11T15:00:00.000Z";
const R2 = "2026-10-11T20:00:00.000Z";
const WEEK = "2026-10-16T09:00:00.000Z";
const rec = (fiveHour: number, resetsAt: string, action?: string): UsageRecord => ({
  at: "t",
  engine: "claude",
  ok: true,
  ...(action ? { action } : {}),
  limits: [
    { kind: "five_hour", utilization: fiveHour, resetsAt },
    { kind: "seven_day", utilization: 0.05, resetsAt: WEEK },
  ],
});

describe("UsageLog", () => {
  it("appends and loads records, skipping broken lines", async () => {
    const folder = fs.mkdtempSync(path.join(root, "f-"));
    const log = new UsageLog(folder);
    await log.append(rec(0.1, R1));
    fs.appendFileSync(path.join(folder, ".harness", "usage.jsonl"), "{broken\n");
    await log.append(rec(0.2, R1, "tidy"));
    expect((await log.load()).map((r) => r.action)).toEqual([undefined, "tidy"]);
  });
});

describe("usageRecord", () => {
  const entry: ChatEntry = { id: "a", role: "assistant", text: "", blocks: [], activities: [], at: "2026-10-11T14:00:00.000Z" };

  it("is null when the engine reported nothing", () => {
    expect(usageRecord(entry, "claude")).toBeNull();
  });

  it("keeps the engine, action, outcome, tokens and limits", () => {
    const usage = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 };
    expect(usageRecord({ ...entry, usage, error: { code: "cancelled" } }, "codex", { action: "tidy" })).toEqual({
      at: "2026-10-11T14:00:00.000Z",
      engine: "codex",
      action: "tidy",
      ok: false,
      usage,
    });
  });

  it("tags the record with its task and phase", () => {
    const usage = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 };
    expect(usageRecord({ ...entry, usage }, "claude", { action: "turn", task: "t1", phase: "close" })).toEqual({
      at: "2026-10-11T14:00:00.000Z",
      engine: "claude",
      action: "turn",
      task: "t1",
      phase: "close",
      ok: true,
      usage,
    });
  });
});

describe("usageRecord first snapshot", () => {
  it("keeps the turn's first limits snapshot when there is one", () => {
    const entry: ChatEntry = { id: "a", role: "assistant", text: "", blocks: [], activities: [], at: "t" };
    const first = [{ kind: "five_hour", utilization: 0.1, resetsAt: R1 }];
    const last = [{ kind: "five_hour", utilization: 0.2, resetsAt: R1 }];
    expect(usageRecord({ ...entry, limits: last }, "claude", { action: "tidy" }, first)).toMatchObject({ limits: last, firstLimits: first });
    expect("firstLimits" in usageRecord({ ...entry, limits: last }, "claude")!).toBe(false);
  });
});

describe("summarizeUsage", () => {
  const now = new Date("2026-10-11T16:00:00.000Z");

  it("has no limits until the engine reports some", () => {
    expect(summarizeUsage([], "five_hour", now)).toEqual({ limits: null, estimates: {}, tokens: {}, primary: "five_hour" });
    expect(summarizeUsage([], undefined, now)).toEqual({ limits: null, estimates: {}, tokens: {} });
  });

  it("returns the latest windows that haven't reset yet", () => {
    expect(summarizeUsage([rec(0.1, R1), rec(0.3, R2)], "five_hour", now).limits).toEqual(rec(0.3, R2).limits);
    expect(summarizeUsage([rec(0.3, R1)], "five_hour", now).limits).toEqual([{ kind: "seven_day", utilization: 0.05, resetsAt: WEEK }]);
  });

  it("credits each action with the rise up to the next snapshot (the limits arrive mid-turn)", () => {
    // Each turn's snapshot is taken while it runs, so its cost shows in the next turn's snapshot.
    const records = [
      rec(0.1, R1, "tidy"),
      rec(0.18, R1), // tidy: +0.08; this free question: +0.02
      rec(0.2, R1, "tidy"),
      rec(0.3, R1, "tidy"), // tidy: +0.10
      rec(0.05, R2), // the window reset: not measured; this free question: +0.45
      rec(0.5, R2, "tidy"), // the latest turn: nothing after it yet
    ];
    const { estimates } = summarizeUsage(records, "five_hour", now);
    expect(Object.keys(estimates)).toEqual(["tidy", "questions"]);
    expect(estimates.tidy).toBeCloseTo(0.09);
    expect(estimates.questions).toBeCloseTo((0.02 + 0.45) / 2);
  });

  it("measures from each turn's first snapshot when the turn reported more than one", () => {
    const records: UsageRecord[] = [
      { ...rec(0.2, R2, "tidy"), firstLimits: [{ kind: "five_hour", utilization: 0.1, resetsAt: R2 }] },
      { ...rec(0.3, R2), firstLimits: [{ kind: "five_hour", utilization: 0.25, resetsAt: R2 }] },
    ];
    const summary = summarizeUsage(records, "five_hour", now);
    expect(summary.estimates.tidy).toBeCloseTo(0.15);
    expect(summary.limits).toEqual(rec(0.3, R2).limits);
  });

  it("does not credit an action with the next turn when the next one has no snapshot", () => {
    const records = [rec(0.1, R1, "tidy"), { at: "t", engine: "claude", ok: true }, rec(0.4, R1)];
    expect(summarizeUsage(records, "five_hour", now).estimates).toEqual({});
  });

  const turn = (fiveHour: number, meta: UsageMeta): UsageRecord => ({ ...rec(fiveHour, R2, meta.action), ...(meta.task ? { task: meta.task } : {}), ...(meta.phase ? { phase: meta.phase } : {}) });

  it("sums a task's turns, leaves out its closing turn, and averages per action across tasks", () => {
    const records = [
      turn(0.1, { action: "tidy", task: "a", phase: "run" }), // a: +0.1
      turn(0.2, { action: "tidy", task: "a", phase: "run" }), // a: +0.1 (follow-up)
      turn(0.3, { action: "tidy", task: "a", phase: "close" }), // closing: +0.05, not counted
      turn(0.35, { action: "tidy", task: "b", phase: "run" }), // b: +0.05
      turn(0.4, { action: "tidy", task: "b", phase: "close" }),
      turn(0.42, {}),
    ];
    // a: 0.2, b: 0.05 -> 0.125 (per turn it would be 0.25 / 3)
    expect(summarizeUsage(records, "five_hour", now).estimates.tidy).toBeCloseTo(0.125);
  });

  it("leaves out a task with a turn it can't measure", () => {
    const records = [
      turn(0.1, { action: "tidy", task: "a", phase: "run" }),
      turn(0.2, { action: "tidy", task: "a", phase: "run" }), // the window resets after it
      { ...rec(0.05, R1), task: "b" },
    ];
    expect(summarizeUsage(records, "five_hour", now).estimates).toEqual({});
  });
});

describe("summarizeUsage over recent tasks", () => {
  const now = new Date("2026-10-11T16:00:00.000Z");
  const usage = (total: number) => ({ inputTokens: total - 30, outputTokens: 10, cacheReadTokens: 10, cacheWriteTokens: 10 });
  /** One task per cost: each turn rises the window by `cost`, and the last line closes the measurement. */
  const tasks = (costs: number[], action?: string, kind = "five_hour"): UsageRecord[] => {
    let at = 0;
    const records: UsageRecord[] = costs.map((cost, i) => {
      const r: UsageRecord = { at: "t", engine: "claude", ok: true, task: `t${i}`, ...(action ? { action } : {}), limits: [{ kind, utilization: at, resetsAt: R2 }] };
      at += cost;
      return r;
    });
    return [...records, { at: "t", engine: "claude", ok: true, limits: [{ kind, utilization: at, resetsAt: R2 }] }];
  };

  it("averages each action over its last 10 measured tasks only", () => {
    // Two old expensive tasks, then ten cheap ones: the old ones no longer count.
    const records = tasks([0.5, 0.5, ...Array<number>(10).fill(0.01)], "tidy");
    expect(summarizeUsage(records, "five_hour", now).estimates.tidy).toBeCloseTo(0.01);
  });

  it("measures the engine's primary window, and none without one", () => {
    const records = tasks([0.04], "tidy", "weekly");
    expect(summarizeUsage(records, "five_hour", now).estimates).toEqual({});
    expect(summarizeUsage(records, "weekly", now)).toMatchObject({ estimates: { tidy: 0.04 }, primary: "weekly" });
    expect(summarizeUsage(records, undefined, now).estimates).toEqual({});
  });

  it("measures free questions under \"questions\"", () => {
    expect(summarizeUsage(tasks([0.03]), "five_hour", now).estimates).toEqual({ questions: 0.03 });
  });

  it("averages total tokens per task over the last 10 tasks whose turns all reported usage", () => {
    const turn = (task: string, total?: number, phase?: "close"): UsageRecord => ({
      at: "t",
      engine: "codex",
      ok: true,
      action: "tidy",
      task,
      ...(phase ? { phase } : {}),
      ...(total !== undefined ? { usage: usage(total) } : {}),
    });
    const records = [
      turn("old", 9_000_000), // pushed out by the ten after it
      ...Array.from({ length: 9 }, (_, i) => turn(`n${i}`, 1000)),
      turn("two", 1500),
      turn("two", 500), // a follow-up: the task is 2000
      turn("two", 99_999, "close"), // closing turn: left out
      turn("gap", 1000),
      { at: "t", engine: "codex", ok: true, action: "tidy", task: "gap", limits: [] }, // a turn without usage: left out
      { at: "t", engine: "codex", ok: true, task: "q", usage: usage(300) },
    ];
    const summary = summarizeUsage(records, undefined, now);
    expect(summary.tokens.tidy).toBeCloseTo((9 * 1000 + 2000) / 10);
    expect(summary.tokens.questions).toBe(300);
    expect(summary.estimates).toEqual({});
  });
});

describe("usage records with the task's profile", () => {
  const entry: ChatEntry = {
    id: "e",
    role: "assistant",
    text: "",
    blocks: [],
    activities: [],
    at: "2026-10-12T12:00:00.000Z",
    usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
  };
  const profile = { engine: "claude", tier: "deep" as const, model: "opus", effort: "high" as const, cap: 400_000 };

  it("records tier, model, effort, cap and the model the engine reported; a checkpoint is its own kind", () => {
    expect(usageRecord(entry, "claude", { action: "turn", task: "t1", phase: "run", ...profileMeta(profile), reportedModel: "claude-opus-4-1" })).toEqual({
      at: entry.at,
      engine: "claude",
      action: "turn",
      task: "t1",
      phase: "run",
      tier: "deep",
      model: "opus",
      effort: "high",
      cap: 400_000,
      reportedModel: "claude-opus-4-1",
      ok: true,
      usage: entry.usage,
    });
    expect(usageRecord(entry, "claude", { phase: "checkpoint", ...profileMeta(profile) })).toMatchObject({ phase: "checkpoint", kind: "checkpoint" });
  });

  it("writes a compaction line without usage", () => {
    const { model: _m, ...codex } = { ...profile, engine: "codex" };
    expect(compactionRecord("codex", { action: "turn", task: "t1", ...profileMeta(codex) }, "2026-10-12T12:00:00.000Z")).toEqual({
      at: "2026-10-12T12:00:00.000Z",
      engine: "codex",
      action: "turn",
      task: "t1",
      tier: "deep",
      effort: "high",
      cap: 400_000,
      kind: "compaction",
      ok: true,
    });
  });

  it("leaves checkpoints and compactions out of the estimates", () => {
    const records: UsageRecord[] = [
      { ...rec(0.1, R1, "turn"), task: "a" },
      { ...rec(0.3, R1, "turn"), task: "a", phase: "checkpoint", kind: "checkpoint" },
      { at: "t", engine: "claude", ok: true, kind: "compaction", action: "turn", task: "a" },
      { ...rec(0.4, R1, "turn"), task: "a" },
      rec(0.5, R1),
    ];
    expect(summarizeUsage(records, "five_hour", new Date("2026-10-11T12:00:00.000Z")).estimates.turn).toBeCloseTo(0.3);
  });
});
