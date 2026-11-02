import { describe, expect, it } from "vitest";
import { type UsageRecord, dayTokens, profilesUsage, subagentRecord, summarizeUsage } from "../src/main/usage-log";

// Subagent slice 1 (measure, D4): the subagents' tokens are their own lines, `phase: "subagent"`.
const R1 = "2026-10-11T15:00:00.000Z";
const WEEK = "2026-10-16T09:00:00.000Z";
const rec = (fiveHour: number, action?: string): UsageRecord => ({
  at: "t",
  engine: "claude",
  ok: true,
  ...(action ? { action } : {}),
  limits: [
    { kind: "five_hour", utilization: fiveHour, resetsAt: R1 },
    { kind: "seven_day", utilization: 0.05, resetsAt: WEEK },
  ],
});
const usage = { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 };
const turn = (task: string, at: string, action?: string): UsageRecord => ({ at, engine: "claude", task, ...(action ? { action } : {}), ok: true, usage });
const sub = { model: "claude-opus-5-5", inputTokens: 13, outputTokens: 7378, cacheReadTokens: 173549, cacheWriteTokens: 37270 };
const SUB_TOKENS = 13 + 7378 + 173549 + 37270;
const subLine = (task: string, at: string, scope?: string) => subagentRecord(sub, "claude", { task, action: "tidy", ...(scope ? { scope } : {}), model: "opus", tier: "deep" }, at);

describe("subagent lines", () => {
  it("a subagent record has phase subagent, the subagent's model, the task's identity and its tokens", () => {
    expect(subLine("t1", "2026-11-02T10:00:00Z", "s1")).toEqual({
      at: "2026-11-02T10:00:00Z",
      engine: "claude",
      action: "tidy",
      task: "t1",
      scope: "s1",
      phase: "subagent",
      model: "claude-opus-5-5",
      ok: true,
      usage: { inputTokens: 13, outputTokens: 7378, cacheReadTokens: 173549, cacheWriteTokens: 37270 },
    });
  });

  it("D0: a log without subagent lines has no subagents total", () => {
    expect(summarizeUsage([turn("t1", "2026-11-02T10:00:00Z", "draft")], undefined)).toEqual({ limits: null, estimates: {}, tokens: { draft: 1100 } });
  });

  it("subagent lines add a subagents total and stay out of the topics and per-scope totals", () => {
    const s = summarizeUsage([{ ...turn("t1", "2026-11-02T10:00:00Z", "draft"), scope: "s1" }, subLine("t1", "2026-11-02T10:00:01Z", "s1"), subLine("t1", "2026-11-02T10:00:02Z", "s1")], undefined);
    expect(s.subagents).toBe(2 * SUB_TOKENS);
    expect(s.tokens).toEqual({ draft: 1100 });
    expect(s.scopes).toEqual({ s1: 1100 });
  });

  it("a subagent line right after a task's turn doesn't leave that turn unmeasured", () => {
    expect(summarizeUsage([rec(0.1, "tidy"), subLine("t1", "t"), rec(0.2)], "five_hour").estimates).toEqual({ tidy: 0.1 });
  });

  it("with profiles, the subagents total is the active profile's", () => {
    const u = profilesUsage({ sofi: [subLine("t1", "2026-11-02T10:00:00Z")], tomas: [subLine("t2", "2026-11-02T10:00:00Z"), subLine("t3", "2026-11-02T10:00:00Z")] }, "sofi", undefined);
    expect(u.subagents).toBe(SUB_TOKENS);
    expect(profilesUsage({ sofi: [], tomas: [subLine("t2", "2026-11-02T10:00:00Z")] }, "sofi", undefined)).not.toHaveProperty("subagents");
  });

  it("a day's tokens leave subagent lines out of the tasks' count", () => {
    const day = (at: string) => at.slice(0, 10);
    expect(dayTokens([turn("t1", "2026-11-02T10:00:00Z"), subLine("t1", "2026-11-02T10:00:01Z")], "2026-11-02", (d) => day(d.toISOString()))).toEqual({ tasks: 1100, sidekick: 0 });
  });
});
