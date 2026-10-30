import { describe, expect, it } from "vitest";
import { type UsageRecord, measurePre, preRecord } from "../src/main/usage-log";

const usage = (inputTokens: number, cacheReadTokens = 0, cacheWriteTokens = 0, outputTokens = 500) => ({ inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });
const turn = (task: string, action: string, u: UsageRecord["usage"], extra: Partial<UsageRecord> = {}): UsageRecord => ({
  at: "2026-10-29T10:00:00.000Z",
  engine: "claude",
  action,
  task,
  phase: "run",
  ok: true,
  ...(u ? { usage: u } : {}),
  ...extra,
});
const pre = (task: string, action: string, preparedTokens: number, ms: number) => preRecord({ engine: "claude", action, task, steps: 2, ms, preparedTokens, ok: true }, "2026-10-29T10:00:00.000Z");

describe("measurePre (tools spec §8.4)", () => {
  it("per action: tasks with a pre row and without, their average first-turn tokens, preparedTokens and ms", () => {
    const records = [turn("A", "study", usage(100_000, 20_000)), pre("B", "study", 800, 300), turn("B", "study", usage(40_000))];
    expect(measurePre(records)).toEqual({
      study: { without: { tasks: 1, firstTurn: 120_000 }, with: { tasks: 1, firstTurn: 40_000, preparedTokens: 800, ms: 300 } },
    });
  });

  it("averages over tasks, rounds, counts cache writes, and keeps actions apart", () => {
    const records = [
      turn("A", "study", usage(100, 0, 1)),
      turn("B", "study", usage(200)),
      pre("C", "study", 100, 10),
      turn("C", "study", usage(50)),
      pre("D", "study", 201, 21),
      turn("D", "study", usage(60)),
      turn("E", "quiz", usage(7)),
    ];
    expect(measurePre(records)).toEqual({
      study: { without: { tasks: 2, firstTurn: 151 }, with: { tasks: 2, firstTurn: 55, preparedTokens: 151, ms: 16 } },
      quiz: { without: { tasks: 1, firstTurn: 7 }, with: { tasks: 0, firstTurn: 0, preparedTokens: 0, ms: 0 } },
    });
  });

  it("a task's first turn is its first run line; close, checkpoint, sidekick, phase-change, job and material lines don't count", () => {
    const records: UsageRecord[] = [
      // Lines before the task's first run turn that are not it.
      turn("A", "study", usage(9_000), { phase: "close" }),
      turn("A", "study", usage(9_000), { phase: "checkpoint", kind: "checkpoint" }),
      turn("A", "study", undefined, { kind: "compaction" }),
      { at: "2026-10-29T10:00:00.000Z", engine: "claude", phase: "job", job: "nightly", task: "A", ok: true, usage: usage(9_000) },
      { at: "2026-10-29T10:00:00.000Z", engine: "claude", phase: "material", stage: "label", scope: "main", ok: true, usage: usage(9_000) },
      // Sidekick's and a phase change's lines carry the task and action: still not its first run turn.
      turn("A", "study", usage(9_000), { phase: "sidekick" }),
      turn("A", "study", usage(9_000), { phase: "phase-change" }),
      turn("A", "study", usage(1_000)),
      // A follow-up turn of the same task: not its first.
      turn("A", "study", usage(5_000)),
      // An expects-miss row is no turn either.
      { at: "2026-10-29T10:00:00.000Z", engine: "claude", kind: "expects-miss", action: "study", task: "A", taskPhase: "p", tool: "x", ok: true },
    ];
    expect(measurePre(records)).toEqual({ study: { without: { tasks: 1, firstTurn: 1_000 }, with: { tasks: 0, firstTurn: 0, preparedTokens: 0, ms: 0 } } });
  });

  it("a line without phase counts as a run line (logs from before turn kinds)", () => {
    const { phase: _phase, ...old } = turn("A", "study", usage(300));
    expect(measurePre([old])).toEqual({ study: { without: { tasks: 1, firstTurn: 300 }, with: { tasks: 0, firstTurn: 0, preparedTokens: 0, ms: 0 } } });
  });

  it("a task with no usage on its first turn is left out", () => {
    const records = [pre("A", "study", 800, 300), turn("A", "study", undefined, { limits: [] }), turn("A", "study", usage(40_000))];
    expect(measurePre(records)).toEqual({});
  });

  it("a pre row without any turn, and a free question (no action), are left out", () => {
    const { action: _action, ...question } = turn("Q", "study", usage(10));
    expect(measurePre([pre("A", "study", 800, 300), question])).toEqual({});
  });

  it("an empty log gives {}", () => {
    expect(measurePre([])).toEqual({});
  });
});
