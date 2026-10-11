import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { ChatEntry } from "@humanharness/ui/client";
import { type UsageRecord, UsageLog, summarizeUsage, usageRecord } from "../src/main/usage-log";

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
    expect(usageRecord({ ...entry, usage, error: { code: "cancelled" } }, "codex", "tidy")).toEqual({
      at: "2026-10-11T14:00:00.000Z",
      engine: "codex",
      action: "tidy",
      ok: false,
      usage,
    });
  });
});

describe("summarizeUsage", () => {
  const now = new Date("2026-10-11T16:00:00.000Z");

  it("has no limits until the engine reports some", () => {
    expect(summarizeUsage([], now)).toEqual({ limits: null, estimates: {} });
  });

  it("returns the latest windows that haven't reset yet", () => {
    expect(summarizeUsage([rec(0.1, R1), rec(0.3, R2)], now).limits).toEqual(rec(0.3, R2).limits);
    expect(summarizeUsage([rec(0.3, R1)], now).limits).toEqual([{ kind: "seven_day", utilization: 0.05, resetsAt: WEEK }]);
  });

  it("credits each action with the rise up to the next snapshot (the limits arrive mid-turn)", () => {
    // Each turn's snapshot is taken while it runs, so its cost shows in the next turn's snapshot.
    const records = [
      rec(0.1, R1, "tidy"),
      rec(0.18, R1), // tidy: +0.08
      rec(0.2, R1, "tidy"),
      rec(0.3, R1, "tidy"), // tidy: +0.10
      rec(0.05, R2), // the window reset: not measured
      rec(0.5, R2, "tidy"), // the latest turn: nothing after it yet
    ];
    const { estimates } = summarizeUsage(records, now);
    expect(Object.keys(estimates)).toEqual(["tidy"]);
    expect(estimates.tidy).toBeCloseTo(0.09);
  });

  it("does not credit an action with the next turn when the next one has no snapshot", () => {
    const records = [rec(0.1, R1, "tidy"), { at: "t", engine: "claude", ok: true }, rec(0.4, R1)];
    expect(summarizeUsage(records, now).estimates).toEqual({});
  });
});
