import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ChatEntry } from "@humanharness/ui/client";
import { type UsageMeta, type UsageRecord, UsageLog, compactionRecord, materialRecord, measuredMaterialCosts, mergeUsage, profileMeta, profilesUsage, sidekickRecord, sidekickSpent, sidekickWeek, summarizeUsage, translateRecord, usageRecord, withSpent } from "../src/main/usage-log";

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

describe("usage per scope", () => {
  const usage = (tokens: number) => ({ inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  it("tags a scoped turn's line with its scope, and only then", () => {
    const entry = { id: "1", role: "assistant" as const, text: "", blocks: [], activities: [], at: "t", usage: usage(10) };
    expect(usageRecord(entry, "claude", { task: "t1", scope: "fracciones" })).toMatchObject({ task: "t1", scope: "fracciones" });
    expect(usageRecord(entry, "claude", { task: "t1" })).not.toHaveProperty("scope");
  });

  it("sums the tokens per scope, and adds nothing when no line has one", () => {
    const line = (scope: string | undefined, tokens: number, phase: "run" | "close" = "run"): UsageRecord => ({
      at: "2026-10-25T10:00:00.000Z",
      engine: "claude",
      ok: true,
      task: `t-${scope}-${tokens}`,
      phase,
      ...(scope ? { scope } : {}),
      usage: usage(tokens),
    });
    expect(summarizeUsage([line("a", 100), line("a", 50, "close"), line("b", 10), line(undefined, 7)], undefined).scopes).toEqual({ a: 150, b: 10 });
    expect(summarizeUsage([line(undefined, 7)], undefined)).not.toHaveProperty("scopes");
  });
});

describe("usage.jsonl: the task's mode (task-modes spec §5.5)", () => {
  const entry: ChatEntry = {
    id: "e",
    role: "assistant",
    text: "",
    blocks: [],
    activities: [],
    at: "t",
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
  };
  it("every line of a task in a mode carries it; none without (D0)", () => {
    expect(usageRecord(entry, "claude", { task: "t1", action: "study", mode: "socratic", phase: "close" })).toMatchObject({ mode: "socratic", phase: "close" });
    expect(usageRecord(entry, "claude", { task: "t1" })).not.toHaveProperty("mode");
    expect(compactionRecord("claude", { task: "t1", mode: "feynman" }, "t")).toMatchObject({ kind: "compaction", mode: "feynman" });
  });
});

describe("usage lines carry the task's phase (task-phases spec §6)", () => {
  it("records taskPhase and the new turn kinds; D0 without them", () => {
    const entry = {
      id: "a",
      role: "assistant" as const,
      text: "",
      blocks: [],
      activities: [],
      at: "2026-10-26T10:00:00.000Z",
      usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
    };
    expect(usageRecord(entry, "claude", { task: "t1", phase: "phase-change", taskPhase: "main" })).toMatchObject({ phase: "phase-change", taskPhase: "main" });
    expect(usageRecord(entry, "claude", { task: "t1", phase: "run" })).not.toHaveProperty("taskPhase");
    expect(compactionRecord("claude", { task: "t1", taskPhase: "close" }, "2026-10-26T10:00:00.000Z")).toMatchObject({ kind: "compaction", taskPhase: "close" });
  });
});

describe("usage across profiles (profiles spec §4 'Usage')", () => {
  const NOW = new Date("2026-10-27T12:30:00.000Z");
  const RESET = "2026-10-27T15:00:00.000Z";
  const turn = (at: string, task: string, fiveHour: number, scope?: string): UsageRecord => ({
    at,
    engine: "claude",
    ok: true,
    action: "practice",
    task,
    ...(scope ? { scope } : {}),
    usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0 },
    limits: [{ kind: "five_hour", utilization: fiveHour, resetsAt: RESET }],
  });
  const sofi = [turn("2026-10-27T10:00:00.000Z", "t1", 0.1, "fracciones"), turn("2026-10-27T12:00:00.000Z", "t3", 0.5, "fracciones")];
  const tomas = [turn("2026-10-27T11:00:00.000Z", "t2", 0.3, "verbos")];

  it("merges every profile's records in time order, each with its profile", () => {
    expect(mergeUsage({ sofi, tomas }).map((r) => [r.task, r.person])).toEqual([
      ["t1", "sofi"],
      ["t2", "tomas"],
      ["t3", "sofi"],
    ]);
  });

  it("measures the shared window across people, counts tokens per person, and keeps the active profile's scopes", () => {
    const u = profilesUsage({ sofi, tomas }, "sofi", "five_hour", NOW);
    // The latest window is Sofi's last turn, whoever ran it.
    expect(u.limits).toEqual([{ kind: "five_hour", utilization: 0.5, resetsAt: RESET }]);
    expect(u.profiles).toEqual({ sofi: 220, tomas: 110 });
    expect(u.scopes).toEqual({ fracciones: 220 });
    // Each task measured against the next record in time, the other person's included.
    expect(u.estimates.practice).toBeGreaterThan(0);
  });

  it("a profile with no log counts nothing; an unknown active profile has no scopes", () => {
    const u = profilesUsage({ sofi: [], tomas }, "nobody", "five_hour", NOW);
    expect(u.profiles).toEqual({ tomas: 110 });
    expect(u).not.toHaveProperty("scopes");
  });
});

describe("material lines", () => {
  it("their own record, left out of the per-action estimates (material spec §11)", () => {
    const line = materialRecord(
      {
        engine: "claude",
        stage: "label",
        scope: "fractions",
        source: "ch2",
        profile: { engine: "claude", tier: "light", effort: "low", cap: 100000 },
        ok: true,
        usage: { inputTokens: 900, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 },
      },
      "2026-10-27T10:00:00.000Z",
    );
    expect(line).toMatchObject({ at: "2026-10-27T10:00:00.000Z", engine: "claude", phase: "material", stage: "label", scope: "fractions", source: "ch2", tier: "light", ok: true });
    const before = summarizeUsage([], undefined);
    const after = summarizeUsage([line], undefined);
    expect(after.estimates).toEqual(before.estimates);
    expect(after.tokens).toEqual(before.tokens);
    expect(after).not.toHaveProperty("scopes");
  });

  it("a stage right after a task's turn leaves that turn unmeasured, not charged with the stage", () => {
    const stage: UsageRecord = { ...rec(0.5, R1), phase: "material", stage: "review", scope: "fractions" };
    const turns = [rec(0.1, R1, "tidy"), rec(0.2, R1), rec(0.3, R1, "tidy"), stage, rec(0.6, R1)];
    // tidy: the first turn measures +0.1; the second is followed by the stage, so it isn't measured.
    expect(summarizeUsage(turns, "five_hour").estimates.tidy).toBeCloseTo(0.1);
    // The stage's window is still the latest one.
    expect(summarizeUsage([rec(0.1, R1, "tidy"), stage], "five_hour", new Date("2026-10-11T14:00:00.000Z")).limits?.[0].utilization).toBe(0.5);
  });

  const line = (stage: string, tokens: number, fragments: number, ok = true) =>
    materialRecord({
      engine: "claude",
      stage,
      scope: "s",
      profile: { engine: "claude", tier: "light", effort: "low", cap: 1 },
      ok,
      fragments,
      usage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    });

  it("measured material costs per fragment, once there are enough lines (material spec §7)", () => {
    expect(line("label", 2000, 20).fragments).toBe(20);
    expect(measuredMaterialCosts([line("label", 2000, 20)])).toBeUndefined();
    const five = Array.from({ length: 5 }, () => line("label", 2000, 20));
    expect(measuredMaterialCosts(five)).toEqual({ label: 100 });
    // Failed lines and lines with no fragments don't count; the sheet is per run.
    expect(measuredMaterialCosts([...Array.from({ length: 4 }, () => line("review", 900, 3)), line("review", 900, 3, false), line("review", 900, 0)])).toBeUndefined();
    expect(measuredMaterialCosts(Array.from({ length: 5 }, () => line("sheet", 3000, 0)))).toEqual({ sheet: 3000 });
    expect(summarizeUsage(five, undefined).material).toBe(10000);
    expect(summarizeUsage([], undefined)).not.toHaveProperty("material");
  });

  it("with profiles, the material total is the active profile's, and each person's total includes their stages", () => {
    const u = profilesUsage({ sofi: [line("label", 2000, 20)], tomas: [line("label", 500, 5)] }, "sofi", undefined);
    expect(u.material).toBe(2000);
    expect(u.profiles).toEqual({ sofi: 2000, tomas: 500 });
    expect(profilesUsage({ sofi: [], tomas: [line("label", 500, 5)] }, "sofi", undefined)).not.toHaveProperty("material");
  });
});

describe("summarizeUsage: spentUsd", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");
  const line = (at: string, costUsd?: number): UsageRecord => ({
    at,
    engine: "opencode",
    ok: true,
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, ...(costUsd !== undefined ? { costUsd } : {}) },
  });

  it("adds up the cost of the last 30 days", () => {
    const s = summarizeUsage([line("2026-09-01T00:00:00.000Z", 5), line("2026-10-20T00:00:00.000Z", 0.25), line("2026-10-27T11:00:00.000Z", 0.5)], undefined, now);
    expect(s.spentUsd).toBeCloseTo(0.75);
  });

  it("is 0 for local models, and absent when no line has a cost (D0)", () => {
    expect(summarizeUsage([line("2026-10-27T11:00:00.000Z", 0)], undefined, now).spentUsd).toBe(0);
    expect(summarizeUsage([line("2026-10-27T11:00:00.000Z")], undefined, now)).not.toHaveProperty("spentUsd");
  });

  it("counts material stages, and is 0 when every cost is older than 30 days", () => {
    const stage: UsageRecord = { ...line("2026-10-27T10:00:00.000Z", 0.1), phase: "material", stage: "label" };
    expect(summarizeUsage([stage, line("2026-10-27T11:00:00.000Z", 0.2)], undefined, now).spentUsd).toBeCloseTo(0.3);
    expect(summarizeUsage([line("2026-09-01T00:00:00.000Z", 5)], undefined, now).spentUsd).toBe(0);
  });

  it("skips a cost that is not finite or is negative", () => {
    const s = summarizeUsage(
      [line("2026-10-27T08:00:00.000Z", Number.NaN), line("2026-10-27T09:00:00.000Z", Number.POSITIVE_INFINITY), line("2026-10-27T10:00:00.000Z", -3), line("2026-10-27T11:00:00.000Z", 0.4)],
      undefined,
      now,
    );
    expect(s.spentUsd).toBeCloseTo(0.4);
    expect(summarizeUsage([line("2026-10-27T10:00:00.000Z", -1), line("2026-10-27T11:00:00.000Z", Number.NaN)], undefined, now)).not.toHaveProperty("spentUsd");
  });

  it("counts every profile's spending (one account pays)", () => {
    const s = profilesUsage({ ana: [line("2026-10-27T10:00:00.000Z", 0.1)], ben: [line("2026-10-27T11:00:00.000Z", 0.2)] }, "ana", undefined, now);
    expect(s.spentUsd).toBeCloseTo(0.3);
  });
});

describe("withSpent", () => {
  const now = new Date("2026-10-27T12:00:00.000Z");
  const line = (engine: string, costUsd?: number): UsageRecord => ({
    at: "2026-10-27T10:00:00.000Z",
    engine,
    ok: true,
    usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, ...(costUsd !== undefined ? { costUsd } : {}) },
  });
  const write = (records: UsageRecord[]) => {
    const folder = fs.mkdtempSync(path.join(root, "spent-"));
    fs.mkdirSync(path.join(folder, ".harness"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".harness", "usage.jsonl"), records.map((r) => JSON.stringify(r) + "\n").join(""));
    return folder;
  };
  const base = { limits: null, estimates: {}, tokens: {} };

  it("reads every line of the window, not only the latest 500, and only the engine's", async () => {
    // 600 paid lines, then 600 of another engine: the latest 500 alone would hold no cost at all.
    const folder = write([...Array.from({ length: 600 }, () => line("opencode", 0.01)), ...Array.from({ length: 600 }, () => line("claude"))]);
    const s = await withSpent({ ...base, spentUsd: 0 }, [folder], "opencode", true, now);
    expect(s.spentUsd).toBeCloseTo(6);
  });

  it("adds up every profile's folder", async () => {
    const s = await withSpent(base, [write([line("opencode", 0.1)]), write([line("opencode", 0.2)])], "opencode", true, now);
    expect(s.spentUsd).toBeCloseTo(0.3);
  });

  it("is absent when no line has a cost, or for an engine that reports none (D0)", async () => {
    expect(await withSpent(base, [write([line("opencode")])], "opencode", true, now)).toEqual(base);
    expect(await withSpent(base, [write([line("claude", 1)])], "claude", false, now)).toEqual(base);
    expect(await withSpent(base, [path.join(root, "missing")], "opencode", true, now)).toEqual(base);
  });
});

describe("sidekick lines (sidekick spec §8)", () => {
  const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 100000 };
  const usage = { inputTokens: 300, outputTokens: 40, cacheReadTokens: 2000, cacheWriteTokens: 100 };
  const turn = (task: string, at: string): UsageRecord => ({ at, engine: "claude", task, action: "draft", ok: true, usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 } });
  const sk = (task: string, at: string) => sidekickRecord({ engine: "claude", task, action: "draft", sidekick: "sidekick", moment: "pre", profile, ok: true, usage }, at);

  it("a line is tagged process, phase, moment and sidekick", () => {
    expect(sk("t1", "2026-10-27T10:00:00Z")).toMatchObject({ phase: "sidekick", process: "sidekick", moment: "pre", sidekick: "sidekick", task: "t1", tier: "light" });
  });

  it("D0: a log without sidekick lines summarizes exactly as before", () => {
    const s = summarizeUsage([turn("t1", "2026-10-27T10:00:00Z"), turn("t1", "2026-10-27T10:01:00Z")], undefined);
    expect(Object.hasOwn(s, "sidekick")).toBe(false);
    expect(s).toEqual({ limits: null, estimates: {}, tokens: { draft: 2200 } });
  });

  it("sidekick lines stay out of task tokens and add a sidekick total", () => {
    const s = summarizeUsage([turn("t1", "2026-10-27T10:00:00Z"), sk("t1", "2026-10-27T10:00:30Z"), turn("t1", "2026-10-27T10:01:00Z")], undefined);
    expect(s.tokens).toEqual({ draft: 2200 });
    expect(s.sidekick).toBe(2440);
  });

  it("stay out of the per-scope totals", () => {
    const line = sidekickRecord({ engine: "claude", task: "t1", scope: "s1", sidekick: "sidekick", moment: "pre", profile, ok: true, usage });
    expect(summarizeUsage([line], undefined)).not.toHaveProperty("scopes");
  });

  it("a sidekick line right after a task's turn leaves that turn unmeasured", () => {
    const between: UsageRecord = { ...sk("t1", "t"), limits: rec(0.25, R1).limits };
    const measured = [rec(0.1, R1, "tidy"), rec(0.2, R1)];
    expect(summarizeUsage(measured, "five_hour").estimates.tidy).toBeCloseTo(0.1);
    expect(summarizeUsage([rec(0.1, R1, "tidy"), between, rec(0.2, R1)], "five_hour").estimates).toEqual({});
  });

  it("spend toward the cap: input + output + cache writes of the task's lines", () => {
    expect(sidekickSpent([sk("t1", "2026-10-27T10:00:00Z"), sk("t2", "2026-10-27T10:00:00Z"), turn("t1", "2026-10-27T10:00:00Z")], "t1")).toBe(440);
  });

  it("the week's tokens", () => {
    expect(sidekickWeek([sk("t0", "2026-10-01T10:00:00Z"), sk("t1", "2026-10-26T10:00:00Z")], new Date("2026-10-27T12:00:00Z"))).toBe(2440);
  });

  it("with profiles, the sidekick total is the active profile's", () => {
    const u = profilesUsage({ sofi: [sk("t1", "2026-10-27T10:00:00Z")], tomas: [sk("t2", "2026-10-27T10:00:00Z"), sk("t3", "2026-10-27T10:00:00Z")] }, "sofi", undefined);
    expect(u.sidekick).toBe(2440);
    expect(profilesUsage({ sofi: [], tomas: [sk("t2", "2026-10-27T10:00:00Z")] }, "sofi", undefined)).not.toHaveProperty("sidekick");
  });
});

describe("translate turns (language spec §5 Measuring)", () => {
  const profile = { engine: "claude", tier: "light" as const, model: "haiku", effort: "low" as const, cap: 3 };
  it("records phase translate with the language and batch", () => {
    const r = translateRecord({ engine: "claude", language: "es", batch: 2, profile, ok: true, usage: { inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 } }, "2026-10-28T10:00:00.000Z");
    expect(r).toMatchObject({ at: "2026-10-28T10:00:00.000Z", engine: "claude", phase: "translate", language: "es", batch: 2, ok: true, tier: "light", model: "haiku" });
    expect(r.usage?.inputTokens).toBe(5);
    expect(translateRecord({ engine: "claude", language: "es", batch: 1, profile, ok: false })).not.toHaveProperty("usage");
  });

  it("are not a task's turn, and a turn right before one can't be measured", () => {
    const w = (u: number) => [{ kind: "five_hour", utilization: u, resetsAt: "2099-01-01T00:00:00.000Z" }];
    const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const records = [
      { at: "1", engine: "claude", action: "a", task: "t1", ok: true, limits: w(10), usage },
      { at: "2", engine: "claude", phase: "translate" as const, language: "es", batch: 1, ok: true, limits: w(20), usage },
    ];
    const s = summarizeUsage(records as never, "five_hour", new Date("2026-10-28T00:00:00Z"));
    expect(s.estimates.a).toBeUndefined();
    expect(s.estimates.questions).toBeUndefined();
    expect(s.tokens.questions).toBeUndefined();
    expect(s.material).toBeUndefined();
    // Their windows still count as the latest limits.
    expect(s.limits?.[0].utilization).toBe(20);
  });

  it("are left out of the per-scope totals", () => {
    const usage = { inputTokens: 3, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const records = [
      { at: "1", engine: "claude", action: "a", task: "t1", scope: "s", ok: true, usage },
      { at: "2", engine: "claude", phase: "translate" as const, scope: "s", language: "es", batch: 1, ok: true, usage },
    ];
    expect(summarizeUsage(records as never, undefined).scopes).toEqual({ s: 3 });
  });
});
