import type { ToolMeta } from "@humanharness/harness-sdk";
import { describe, expect, it } from "vitest";
import { type StepCallBase, type StepRegistry, type StepValues, runToolStep } from "../../src/main/tools/pre-steps";
import type { ToolAnswer, ToolCall } from "../../src/main/tools/tool-registry";

const meta: ToolMeta = {
  description: "Posts one ticket",
  agent: "call",
  uses: {},
  params: { type: "object", properties: { id: { type: "string" } } },
  timeout: 30,
  file: "tools/post.js",
};

/** A registry double: `answer(call)` answers each call (maybe after a delay), every call recorded. */
function registry(answer: (c: ToolCall) => ToolAnswer | Promise<ToolAnswer>) {
  const calls: ToolCall[] = [];
  const r: StepRegistry = {
    call: async (c) => (calls.push(c), answer(c)),
    meta: async () => meta,
  };
  return { r, calls };
}

const base: StepCallBase = { caller: "job", scope: null, job: "sync", run: "r1" };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idOf = (c: ToolCall) => (c.args as { id: string }).id;
const list = (ids: string[]): StepValues => new Map([["tickets", { ok: true, value: ids.map((id) => ({ id })) }]]);

describe("runToolStep carries a call's summary and request (slice 4)", () => {
  it("a single call: summary and requestAi from its answer", async () => {
    const { r } = registry(() => ({ ok: true, result: 7, summary: "Posted 7", requestAi: { input: { more: true } } }));
    expect(await runToolStep(r, { tool: "post" }, new Map(), { ...base, post: true })).toStrictEqual({
      ok: true,
      value: 7,
      summary: "Posted 7",
      requestAi: { input: { more: true } },
    });
  });

  it("a single failed call keeps its summary", async () => {
    const { r } = registry(() => ({ ok: false, error: "post failed: 500", summary: "Half done" }));
    expect(await runToolStep(r, { tool: "post" }, new Map(), base)).toStrictEqual({ ok: false, error: "post failed: 500", summary: "Half done" });
  });

  it("forEach: the last summary in item order, the first request in item order", async () => {
    // Item a finishes last, item d first: the order calls end in never decides.
    const delay: Record<string, number> = { a: 40, b: 25, c: 10, d: 1 };
    const { r } = registry(async (c) => {
      const id = idOf(c);
      await wait(delay[id] ?? 0);
      return { ok: true, result: id, ...(id !== "d" ? { summary: `item ${id}` } : {}), ...(id === "b" || id === "c" ? { requestAi: { input: { from: id } } } : {}) };
    });
    expect(await runToolStep(r, { tool: "post", forEach: "tickets" }, list(["a", "b", "c", "d"]), { ...base, post: true })).toStrictEqual({
      ok: true,
      value: ["a", "b", "c", "d"],
      summary: "item c",
      requestAi: { input: { from: "b" } },
    });
  });

  it("forEach: a failed item fails the step with no request; the summary given so far stays", async () => {
    const { r } = registry(async (c) =>
      idOf(c) === "b" ? { ok: false, error: "post failed: 500" } : { ok: true, result: 1, summary: `item ${idOf(c)}`, requestAi: { input: 1 } },
    );
    const out = await runToolStep(r, { tool: "post", forEach: "tickets" }, list(["a", "b"]), { ...base, post: true });
    expect(out).toStrictEqual({ ok: false, error: "post failed: 500", summary: "item a" });
  });

  it("extra.post reaches every call of the step", async () => {
    const { r, calls } = registry(() => ({ ok: true, result: 1 }));
    await runToolStep(r, { tool: "post", forEach: "tickets" }, list(["a", "b", "c"]), { ...base, post: true });
    expect(calls).toHaveLength(3);
    for (const c of calls) expect(c.post).toBe(true);
  });

  it("D0: a pre-step's result is as before (no summary or requestAi keys when the answers have none)", async () => {
    const { r } = registry(() => ({ ok: true, result: 1 }));
    const pre: StepCallBase = { caller: "pre", scope: "intro", task: "t1" };
    expect(await runToolStep(r, { tool: "post" }, new Map(), pre)).toStrictEqual({ ok: true, value: 1 });
    expect(await runToolStep(r, { tool: "post", forEach: "tickets" }, list(["a", "b"]), pre)).toStrictEqual({ ok: true, value: [1, 1] });
    const failing = registry(() => ({ ok: false, error: "nope" }));
    expect(await runToolStep(failing.r, { tool: "post", forEach: "tickets" }, list(["a"]), pre)).toStrictEqual({ ok: false, error: "nope" });
  });
});
