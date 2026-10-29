import type { PreStep, ToolMeta } from "@humanharness/harness-sdk";
import { describe, expect, it } from "vitest";
import { runPreSteps, type StepRegistry } from "../../src/main/tools/pre-steps";
import type { ToolAnswer, ToolCall } from "../../src/main/tools/tool-registry";

const meta = (properties: Record<string, unknown> = {}): ToolMeta => ({
  description: "A tool the runner calls in these tests",
  agent: "call",
  uses: {},
  params: { type: "object", properties },
  timeout: 30,
  file: "tools/a.js",
});

type Answer = ToolAnswer | ((c: ToolCall) => ToolAnswer | Promise<ToolAnswer>);

/** A registry double: answers by tool from a table, records every call; meta from a small tools.json. */
function registry(answers: Record<string, Answer>, tools: Record<string, ToolMeta> = {}) {
  const calls: ToolCall[] = [];
  const r: StepRegistry = {
    call: async (c) => {
      calls.push(c);
      const a = answers[c.tool];
      if (a === undefined) return { ok: false, error: `${c.tool} is not a tool` };
      return typeof a === "function" ? a(c) : a;
    },
    meta: async (id) => tools[id] ?? null,
  };
  return { r, calls };
}

const run = (r: StepRegistry, steps: PreStep[], over: { phase?: string; now?: () => number } = {}) =>
  runPreSteps({ registry: r, steps, task: "t1", scope: "intro", ...over });

describe("runPreSteps (tools spec §6)", () => {
  it("runs the steps in order as caller pre, with the task, scope and phase", async () => {
    const { r, calls } = registry({ a: { ok: true, result: 1 }, b: { ok: true, result: 2 } });
    const out = await run(
      r,
      [
        { tool: "a", as: "x" },
        { tool: "b", as: "y" },
      ],
      { phase: "warmup" },
    );
    expect(calls.map((c) => c.tool)).toEqual(["a", "b"]);
    for (const c of calls) expect(c).toMatchObject({ caller: "pre", task: "t1", scope: "intro", phase: "warmup" });
    expect(out.results.map((x) => [x.as, x.tool, x.ok, x.value])).toEqual([
      ["x", "a", true, 1],
      ["y", "b", true, 2],
    ]);
    expect(out.requiredFailure).toBeUndefined();
  });

  it("sends no phase and no inputs when there are none", async () => {
    const { r, calls } = registry({ a: { ok: true, result: 1 } });
    await run(r, [{ tool: "a" }]);
    expect(calls[0]).toEqual({ caller: "pre", task: "t1", scope: "intro", tool: "a", args: {} });
  });

  it("passes args and the named earlier results as inputs", async () => {
    const today = [{ id: "d1" }];
    const { r, calls } = registry({ a: { ok: true, result: today }, b: { ok: true, result: "ok" } });
    await run(r, [
      { tool: "a", as: "today" },
      { tool: "b", args: { n: 3 }, input: ["today"], as: "warmup" },
    ]);
    expect(calls[1].args).toEqual({ n: 3 });
    expect(calls[1].inputs).toEqual({ today });
  });

  it("inputs hold only the named results", async () => {
    const { r, calls } = registry({ a: { ok: true, result: 1 }, b: { ok: true, result: 2 }, c: { ok: true, result: 3 } });
    await run(r, [
      { tool: "a", as: "one" },
      { tool: "b", as: "two" },
      { tool: "c", input: ["two"] },
    ]);
    expect(calls[2].inputs).toEqual({ two: 2 });
  });

  it("forEach calls the tool once per item, params from the item's fields of the tool's params, args over them", async () => {
    const prs = [
      { repo: "r", number: 1, title: "x" },
      { repo: "r", number: 2 },
    ];
    const { r, calls } = registry(
      { a: { ok: true, result: prs }, b: (c) => ({ ok: true, result: `b${(c.args as { number: number }).number}` }) },
      { b: meta({ repo: { type: "string" }, number: { type: "integer" } }) },
    );
    const out = await run(r, [
      { tool: "a", as: "prs" },
      { tool: "b", forEach: "prs", args: { repo: "q" }, as: "ci" },
    ]);
    expect(calls.slice(1).map((c) => c.args)).toEqual([
      { repo: "q", number: 1 },
      { repo: "q", number: 2 },
    ]);
    expect(out.results[1]).toMatchObject({ as: "ci", ok: true, value: ["b1", "b2"] });
  });

  it("forEach runs at most 4 calls at a time and keeps the item order", async () => {
    let inFlight = 0;
    let most = 0;
    const items = Array.from({ length: 10 }, (_, i) => ({ i }));
    const { r } = registry(
      {
        a: { ok: true, result: items },
        b: async (c) => {
          const i = (c.args as { i: number }).i;
          inFlight++;
          most = Math.max(most, inFlight);
          await new Promise((res) => setTimeout(res, (10 - i) * 2));
          inFlight--;
          return { ok: true, result: i * 10 };
        },
      },
      { b: meta({ i: { type: "integer" } }) },
    );
    const out = await run(r, [
      { tool: "a", as: "items" },
      { tool: "b", forEach: "items", as: "tens" },
    ]);
    expect(most).toBe(4);
    expect(out.results[1].value).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90]);
  });

  it("forEach over more than 100 items fails the step", async () => {
    const { r, calls } = registry({ a: { ok: true, result: Array.from({ length: 101 }, () => ({})) }, b: { ok: true, result: 1 } });
    const out = await run(r, [
      { tool: "a", as: "many" },
      { tool: "b", forEach: "many", as: "each" },
    ]);
    expect(out.results[1]).toMatchObject({ as: "each", tool: "b", ok: false, error: "forEach over 101 items; at most 100" });
    expect(calls.map((c) => c.tool)).toEqual(["a"]);
  });

  it("forEach over exactly 100 items runs", async () => {
    const { r, calls } = registry({ a: { ok: true, result: Array.from({ length: 100 }, () => ({})) }, b: { ok: true, result: 1 } });
    const out = await run(r, [
      { tool: "a", as: "many" },
      { tool: "b", forEach: "many", as: "each" },
    ]);
    expect(out.results[1].ok).toBe(true);
    expect(calls.filter((c) => c.tool === "b")).toHaveLength(100);
  });

  it("forEach over a value that isn't an array fails the step", async () => {
    const { r, calls } = registry({ a: { ok: true, result: { not: "a list" } }, b: { ok: true, result: 1 } });
    const out = await run(r, [
      { tool: "a", as: "prs" },
      { tool: "b", forEach: "prs", as: "ci" },
    ]);
    expect(out.results[1]).toMatchObject({ ok: false, error: "prs is not a list" });
    expect(calls.map((c) => c.tool)).toEqual(["a"]);
  });

  it("one failed item fails the forEach step with its error", async () => {
    const { r } = registry(
      {
        a: { ok: true, result: [{ n: 1 }, { n: 2 }, { n: 3 }] },
        b: (c) => ((c.args as { n: number }).n === 2 ? { ok: false, error: "item two broke" } : { ok: true, result: 1 }),
      },
      { b: meta({ n: { type: "integer" } }) },
    );
    const out = await run(r, [
      { tool: "a", as: "ns" },
      { tool: "b", forEach: "ns", as: "each" },
    ]);
    expect(out.results[1]).toMatchObject({ as: "each", ok: false, error: "item two broke" });
    expect(out.results[1].value).toBeUndefined();
  });

  it("a failed step is kept with its message and the next steps still run", async () => {
    const { r } = registry({ a: { ok: false, error: "boom" }, b: { ok: true, result: 2 } });
    const out = await run(r, [
      { tool: "a", as: "x" },
      { tool: "b", as: "y" },
    ]);
    expect(out.results[0]).toMatchObject({ as: "x", tool: "a", ok: false, error: "boom" });
    expect(out.results[0].value).toBeUndefined();
    expect(out.results[1]).toMatchObject({ as: "y", ok: true, value: 2 });
    expect(out.requiredFailure).toBeUndefined();
  });

  it("a step whose input names a failed result is skipped with a reason", async () => {
    const { r, calls } = registry({ a: { ok: false, error: "boom" }, b: { ok: true, result: 2 } });
    const out = await run(r, [
      { tool: "a", as: "today" },
      { tool: "b", input: ["today"], as: "y" },
    ]);
    expect(out.results[1]).toMatchObject({ as: "y", tool: "b", ok: false, error: '"today" is not available: a failed' });
    expect(calls.map((c) => c.tool)).toEqual(["a"]);
  });

  it("a forEach over a failed result is skipped with a reason", async () => {
    const { r, calls } = registry({ a: { ok: false, error: "boom" }, b: { ok: true, result: 2 } });
    const out = await run(r, [
      { tool: "a", as: "prs" },
      { tool: "b", forEach: "prs", as: "ci" },
    ]);
    expect(out.results[1]).toMatchObject({ ok: false, error: '"prs" is not available: a failed' });
    expect(calls.map((c) => c.tool)).toEqual(["a"]);
  });

  it("a failed required step stops the run and is reported", async () => {
    const { r, calls } = registry({ a: { ok: false, error: "boom" }, b: { ok: true, result: 2 } });
    const out = await run(r, [{ tool: "a", required: true, as: "x" }, { tool: "b" }]);
    expect(out.requiredFailure).toEqual({ tool: "a", error: "boom" });
    expect(out.results).toHaveLength(1);
    expect(calls.map((c) => c.tool)).toEqual(["a"]);
  });

  it("a required step that succeeds lets the run go on", async () => {
    const { r, calls } = registry({ a: { ok: true, result: 1 }, b: { ok: true, result: 2 } });
    const out = await run(r, [{ tool: "a", required: true, as: "x" }, { tool: "b" }]);
    expect(out.requiredFailure).toBeUndefined();
    expect(calls.map((c) => c.tool)).toEqual(["a", "b"]);
  });

  it("a failed step's message is the registry's redacted text", async () => {
    const { r } = registry({ a: { ok: false, error: "bad token [redacted]" } });
    const out = await run(r, [{ tool: "a", required: true, as: "x" }]);
    expect(out.results[0].error).toBe("bad token [redacted]");
    expect(out.requiredFailure).toEqual({ tool: "a", error: "bad token [redacted]" });
  });

  it("measures each step's time and the whole run", async () => {
    const ticks = [100, 100, 130, 130, 180, 185];
    const now = () => ticks.shift() ?? 999;
    const { r } = registry({ a: { ok: true, result: 1 }, b: { ok: true, result: 2 } });
    const out = await run(
      r,
      [
        { tool: "a", as: "x" },
        { tool: "b", as: "y" },
      ],
      { now },
    );
    expect(out.results.map((x) => x.ms)).toEqual([30, 50]);
    expect(out.ms).toBe(85);
  });
});
