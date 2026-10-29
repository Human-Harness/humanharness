import { describe, expect, it } from "vitest";
import { expectsMisses } from "../../src/main/tools/expects";
import type { TraceEntry } from "../../src/main/tools/tool-trace";

/** A traced agent call of task t1 in its close part, unless the fields say otherwise. */
const entry = (e: Partial<TraceEntry>): TraceEntry => ({
  at: "2026-10-29T10:00:00.000Z",
  tool: "apply-evidence",
  caller: "agent",
  task: "t1",
  phase: "close",
  args: {},
  resultSummary: "ok",
  ms: 3,
  ok: true,
  accesses: [],
  ...e,
});

describe("expectsMisses (tools spec §6.1)", () => {
  it("a tool called in that part by this task is not a miss", () => {
    expect(expectsMisses([entry({ tool: "apply-evidence", task: "t1", phase: "close" })], { task: "t1", phase: "close", expects: ["apply-evidence"] })).toEqual([]);
  });

  it("a call in another part, of another task, or a note doesn't count", () => {
    const es = [
      entry({ tool: "apply-evidence", task: "t1", phase: "main" }),
      entry({ tool: "apply-evidence", task: "t2", phase: "close" }),
      entry({ tool: "apply-evidence", task: "t1", phase: "close", note: "x" }),
      entry({ tool: "apply-evidence", task: "t1", phase: undefined }),
    ];
    expect(expectsMisses(es, { task: "t1", phase: "close", expects: ["apply-evidence"] })).toEqual(["apply-evidence"]);
  });

  it("a failed call still counts as called", () => {
    const failed = entry({ ok: false, error: "The tool failed", resultSummary: "" });
    expect(expectsMisses([failed], { task: "t1", phase: "close", expects: ["apply-evidence"] })).toEqual([]);
  });

  it("any caller counts: a pre-step or the UI calling it in that part is a call", () => {
    const es = [entry({ tool: "a", caller: "pre" }), entry({ tool: "b", caller: "ui" })];
    expect(expectsMisses(es, { task: "t1", phase: "close", expects: ["a", "b", "c"] })).toEqual(["c"]);
  });

  it("each expected tool is reported once, in the order declared", () => {
    const es = [entry({ tool: "b" })];
    expect(expectsMisses(es, { task: "t1", phase: "close", expects: ["d", "b", "a", "d", "c", "a"] })).toEqual(["d", "a", "c"]);
  });

  it("no entries: every expected tool is a miss; no expects: none", () => {
    expect(expectsMisses([], { task: "t1", phase: "close", expects: ["a", "b"] })).toEqual(["a", "b"]);
    expect(expectsMisses([entry({})], { task: "t1", phase: "close", expects: [] })).toEqual([]);
  });
});
