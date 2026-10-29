import { afterEach, describe, expect, it, vi } from "vitest";
import { type HarnessJob, z } from "@humanharness/harness-sdk";
import type { HistoryTrailer } from "@humanharness/workspace";
import type { AiStepResult } from "../../src/main/jobs/ai-step";
import type { JobRunRecord } from "../../src/main/jobs/job-log";
import { type RecipeRunDeps, runRecipe } from "../../src/main/jobs/recipe-runner";
import type { ToolAnswer, ToolCall } from "../../src/main/tools/tool-registry";
import { TurnGate } from "../../src/main/turn-gate";

afterEach(() => vi.restoreAllMocks());

const output = z.object({ ids: z.array(z.string()), again: z.boolean() });
const job = (steps: unknown[], extra: Record<string, unknown> = {}): HarnessJob =>
  ({ label: "Sync", on: { manual: true }, scope: "none", tier: "light", steps, ...extra }) as never;
const full = [
  { tool: "pr-ci", as: "ci" },
  { ai: "./b.md", input: ["ci"], output, tier: "light", as: "triage", when: { from: "ci", where: { failed: true } } },
  { tool: "apply-triage", input: ["triage"] },
  { tool: "notify" },
];
const RED = [{ failed: true, pr: 1 }];
const TRIAGE = { ids: ["a"], again: false };
const LIMITS = { job: "sync", web: false, exec: false };
const AT = Date.parse("2026-10-29T10:00:00.000Z");

type Answer = ToolAnswer | ((c: ToolCall) => ToolAnswer | Promise<ToolAnswer>);
type AiCall = { job: string; run: string; round: number; scope: string | null; data: { name: string; value: unknown }[]; signal?: AbortSignal };
type AiPlay = AiStepResult | ((o: AiCall) => Promise<AiStepResult>);

const okAnswer = (result: unknown, more: Partial<Extract<ToolAnswer, { ok: true }>> = {}): ToolAnswer => ({ ok: true, result, ...more });

/**
 * The runner's deps: a registry double answering by tool (an array: one answer per call, the last one repeats), an
 * `ai` double playing one result per round, a real TurnGate (jobs cap 1), a log double and a fake clock (10 ms a read).
 */
function wire(o: {
  answers?: Record<string, Answer | Answer[]>;
  ai?: AiPlay[];
  actions?: Record<string, unknown>;
  gate?: TurnGate;
  stillValid?: () => Promise<boolean>;
  maxMs?: number;
  last?: { tool: string; resultSummary: string } | null;
  ids?: string[];
  toolScope?: string;
} = {}) {
  const answers: Record<string, Answer | Answer[]> = { "pr-ci": okAnswer(RED), "apply-triage": okAnswer({ done: 1 }), notify: okAnswer("sent"), ...o.answers };
  const calls: (ToolCall & { trailer?: HistoryTrailer })[] = [];
  const aiCalls: AiCall[] = [];
  const notes: unknown[] = [];
  const logged: JobRunRecord[] = [];
  const rows: unknown[] = [];
  const seen = new Map<string, number>();
  let trailer: HistoryTrailer | undefined;
  let clock = AT;
  const ids = [...(o.ids ?? ["r1", "r2", "r3"])];
  const gate = o.gate ?? new TurnGate({ tasks: 1, jobs: 1 });
  const deps: RecipeRunDeps = {
    gate,
    log: { append: async (r) => void logged.push(r) },
    registry: {
      async call(c) {
        calls.push({ ...c, ...(trailer ? { trailer } : {}) });
        const n = seen.get(c.tool) ?? 0;
        seen.set(c.tool, n + 1);
        const a = answers[c.tool];
        if (a === undefined) throw new Error(`unexpected tool ${c.tool}`);
        const one = Array.isArray(a) ? a[Math.min(n, a.length - 1)]! : a;
        return typeof one === "function" ? one(c) : one;
      },
      meta: async () => null,
      note: async (n) => void notes.push(n),
    },
    withRunTrailer: async (t, fn) => {
      trailer = t;
      try {
        return await fn();
      } finally {
        trailer = undefined;
      }
    },
    limits: (id) => ({ ...LIMITS, job: id }),
    lastCall: async () => (o.last === undefined ? { tool: "notify", resultSummary: "a string" } : o.last),
    ai: async (a) => {
      aiCalls.push({ job: a.job, run: a.run, round: a.round, scope: a.scope, data: a.data, ...(a.signal ? { signal: a.signal } : {}) });
      const play = o.ai?.[aiCalls.length - 1] ?? { ok: true, value: TRIAGE, tokens: 1234 };
      return typeof play === "function" ? play(aiCalls.at(-1)!) : play;
    },
    recordRecipe: async (r) => void rows.push(r),
    actions: o.actions ?? { "triage-ci": {} },
    ...(o.stillValid ? { stillValid: o.stillValid } : {}),
    now: () => new Date((clock += 10)),
    newId: () => ids.shift() ?? "rX",
    ...(o.maxMs !== undefined ? { maxMs: o.maxMs } : {}),
    ...(o.toolScope !== undefined ? { toolScope: o.toolScope } : {}),
  };
  const run = (j: HarnessJob, signal?: AbortSignal, scope: string | null = null) => runRecipe(deps, "sync", j, scope, "manual", signal);
  return { deps, run, calls, aiCalls, notes, logged, rows, gate };
}

/** A call's fields as the runner sent them (the trailer the double saw aside). */
const sent = (c: ToolCall & { trailer?: HistoryTrailer }) => {
  const { trailer: _t, ...rest } = c;
  return rest;
};

describe("runRecipe (tools spec §7)", () => {
  it("runs tool steps in order as caller job with the job, run, scope and the job's limits", async () => {
    const w = wire();
    await w.run(job(full));
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci", "apply-triage", "notify"]);
    expect(sent(w.calls[0]!)).toStrictEqual({ caller: "job", job: "sync", run: "r1", scope: null, limits: LIMITS, tool: "pr-ci", args: {} });
    expect(sent(w.calls[2]!)).toStrictEqual({ caller: "job", job: "sync", run: "r1", scope: null, limits: LIMITS, tool: "notify", args: {} });
  });

  it("passes the run's scope to every call and to the AI step", async () => {
    const w = wire();
    await w.run(job(full), undefined, "intro");
    expect(w.calls.every((c) => c.scope === "intro")).toBe(true);
    expect(w.aiCalls[0]!.scope).toBe("intro");
  });

  it("an app-wide run's tool calls see the tool scope; the record, the AI step and the trailer keep the run's null", async () => {
    const w = wire({ toolScope: "_app" });
    const r = await w.run(job(full));
    expect(w.calls.map((c) => c.scope)).toEqual(["_app", "_app", "_app"]);
    expect(w.aiCalls[0]!.scope).toBeNull();
    expect(w.calls.map((c) => c.trailer)).toEqual(Array(3).fill({ task: "r1", job: "sync" }));
    expect(r!.scope).toBeNull();
    expect(w.logged[0]!.scope).toBeNull();
    expect(Object.hasOwn(w.rows[0] as object, "scope")).toBe(false);
  });

  it("every tool call runs with the run's history trailer (a tool's data write commits under it)", async () => {
    const w = wire();
    await w.run(job(full), undefined, "intro");
    expect(w.calls.map((c) => c.trailer)).toEqual(Array(3).fill({ task: "r1", job: "sync", scope: "intro" }));
    const app = wire();
    await app.run(job([{ tool: "notify" }]));
    expect(app.calls[0]!.trailer).toStrictEqual({ task: "r1", job: "sync" });
  });

  it("the AI step gets its inputs as data and its result is the post-step's input", async () => {
    const w = wire();
    await w.run(job(full));
    expect(w.aiCalls).toEqual([expect.objectContaining({ job: "sync", run: "r1", round: 1, data: [{ name: "ci", value: RED }] })]);
    expect(w.calls[1]!.inputs).toStrictEqual({ triage: TRIAGE });
  });

  it("only the post-step's calls are marked post", async () => {
    const w = wire();
    await w.run(job(full));
    expect(w.calls.map((c) => c.post)).toEqual([undefined, true, undefined]);
    expect(w.calls[1]!.caller).toBe("job");
  });

  it("when false skips the AI step and every step after it, and ends ok", async () => {
    const w = wire({ answers: { "pr-ci": okAnswer([{ failed: false }]) }, last: { tool: "pr-ci", resultSummary: "1 item" } });
    const r = await w.run(job(full));
    expect(w.aiCalls).toEqual([]);
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci"]);
    expect(r).toMatchObject({ status: "ok", summary: "1 step · pr-ci: 1 item", tokens: 0 });
  });

  it("a failed tool step ends the run failed with the tool and the message; nothing after it runs", async () => {
    const w = wire({ answers: { "pr-ci": { ok: false, error: "boom [redacted]" } } });
    const r = await w.run(job(full));
    expect(r).toMatchObject({ status: "failed", summary: "pr-ci failed: boom [redacted]" });
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci"]);
    expect(w.aiCalls).toEqual([]);
  });

  it("a failed post-step ends the run failed; the step after it never runs", async () => {
    const w = wire({ answers: { "apply-triage": { ok: false, error: "no access" } } });
    const r = await w.run(job(full));
    expect(r).toMatchObject({ status: "failed", summary: "apply-triage failed: no access" });
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci", "apply-triage"]);
  });

  it("invalid AI output twice ends the run failed with the AI step's error; the post-step never runs", async () => {
    const w = wire({ ai: [{ ok: false, error: "The AI step gave no valid output: it was not called", tokens: 50 }] });
    const r = await w.run(job(full));
    expect(r).toMatchObject({ status: "failed", summary: "The AI step gave no valid output: it was not called", tokens: 50 });
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci"]);
  });

  it("a first AI round the engine cancelled on its own (no abort) fails the run Cancelled; nothing after it runs", async () => {
    const w = wire({ ai: [{ ok: false, error: "Cancelled", cancelled: true, tokens: 4 }] });
    const r = await w.run(job(full));
    expect(r).toMatchObject({ status: "failed", summary: "Cancelled", tokens: 4 });
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci"]);
    // An AI step with no `as` too: the steps after it never run.
    const noAs = wire({ ai: [{ ok: false, error: "Cancelled", cancelled: true, tokens: 0 }] });
    const bare = await noAs.run(job([{ tool: "pr-ci", as: "ci" }, { ai: "./b.md", input: ["ci"], output }, { tool: "notify" }]));
    expect(bare).toMatchObject({ status: "failed", summary: "Cancelled" });
    expect(noAs.calls.map((c) => c.tool)).toEqual(["pr-ci"]);
  });

  it("an extra AI round the engine cancelled on its own (no abort) fails the run Cancelled; nothing after it runs", async () => {
    const w = wire({
      answers: { "apply-triage": okAnswer({}, { requestAi: { input: {} } }) },
      ai: [
        { ok: true, value: TRIAGE, tokens: 10 },
        { ok: false, error: "Cancelled", cancelled: true, tokens: 2 },
      ],
    });
    const r = await w.run(job(full, { maxAi: 2 }));
    expect(r).toMatchObject({ status: "failed", summary: "Cancelled", tokens: 12 });
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci", "apply-triage"]);
  });

  it("an AI step input that is not available fails the run without an AI call", async () => {
    // The AI step reads "ci", which no step gave: the runner decides before any AI call (dataSection never sees it).
    const w = wire();
    const r = await w.run(job([{ tool: "pr-ci" }, { ai: "./b.md", input: ["ci"], output, as: "triage" }, { tool: "notify" }]));
    expect(r).toMatchObject({ status: "failed", summary: '"ci" is not available' });
    expect(w.aiCalls).toEqual([]);
  });

  it("requestAi within maxAi runs the AI step again with the request as data, then the post-step again", async () => {
    const again = { ids: ["b"], again: false };
    const w = wire({
      answers: { "apply-triage": [okAnswer({ done: 1 }, { requestAi: { input: { ids: ["b"] } } }), okAnswer({ done: 2 })] },
      ai: [
        { ok: true, value: TRIAGE, tokens: 100 },
        { ok: true, value: again, tokens: 40 },
      ],
    });
    const r = await w.run(job(full, { maxAi: 2 }));
    expect(w.aiCalls.map((a) => [a.round, a.data])).toEqual([
      [1, [{ name: "ci", value: RED }]],
      [2, [{ name: "request", value: { ids: ["b"] } }]],
    ]);
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci", "apply-triage", "apply-triage", "notify"]);
    expect(w.calls[2]!.inputs).toStrictEqual({ triage: again });
    expect(w.calls[2]!.post).toBe(true);
    expect(r).toMatchObject({ status: "ok", tokens: 140 });
    expect(w.rows[0]).toMatchObject({ toolSteps: 4, aiSteps: 2 });
  });

  it("requestAi beyond maxAi ends needs-you with the summary and onLimit; nothing after it runs", async () => {
    const w = wire({ answers: { "apply-triage": okAnswer({ done: 1 }, { requestAi: { input: {} }, summary: "2 still red" }) } });
    const r = await w.run(job(full, { onLimit: "triage-ci" }));
    expect(r).toMatchObject({ status: "needs-you", summary: "Stopped after 1 AI step · 2 still red", action: "triage-ci" });
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci", "apply-triage"]);
    expect(w.aiCalls).toHaveLength(1);
  });

  it("the stop shows the post-step's own summary, never an earlier step's", async () => {
    const w = wire({ answers: { "pr-ci": okAnswer(RED, { summary: "CI read" }), "apply-triage": okAnswer({}, { requestAi: { input: {} } }) } });
    const r = await w.run(job(full));
    expect(r).toMatchObject({ status: "needs-you", summary: "Stopped after 1 AI step" });
  });

  it("Stopped after N AI steps is plural above one; without a summary it is the bare line", async () => {
    const w = wire({ answers: { "apply-triage": okAnswer({}, { requestAi: { input: {} } }) } });
    const r = await w.run(job(full, { maxAi: 3 }));
    expect(w.aiCalls).toHaveLength(3);
    expect(r).toMatchObject({ status: "needs-you", summary: "Stopped after 3 AI steps" });
    expect(Object.hasOwn(r!, "action")).toBe(false);
  });

  it("onLimit naming no action is dropped (the runner's own J3 check)", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = wire({ answers: { "apply-triage": okAnswer({}, { requestAi: { input: {} } }) }, actions: {} });
    const r = await w.run(job(full, { onLimit: "triage-ci" }));
    expect(r!.status).toBe("needs-you");
    expect(Object.hasOwn(r!, "action")).toBe(false);
    expect(err).toHaveBeenCalled();
  });

  it("an onLimit that is an inherited name is not an action", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const w = wire({ answers: { "apply-triage": okAnswer({}, { requestAi: { input: {} } }) }, actions: {} });
    const r = await w.run(job(full, { onLimit: "toString" }));
    expect(Object.hasOwn(r!, "action")).toBe(false);
  });

  it("ok uses the last ctx.summary of any step", async () => {
    const w = wire({ answers: { "pr-ci": okAnswer(RED, { summary: "CI read" }), "apply-triage": okAnswer({}, { summary: "Triaged 2" }) } });
    const r = await w.run(job(full));
    expect(r).toMatchObject({ status: "ok", summary: "Triaged 2" });
  });

  it("a step after the post-step may set the summary too", async () => {
    const w = wire({ answers: { notify: okAnswer("sent", { summary: "Notified" }) } });
    expect((await w.run(job(full)))!.summary).toBe("Notified");
  });

  it("ok without a summary builds one from the counts and the last call", async () => {
    const w = wire({ last: { tool: "notify", resultSummary: "\"sent\"" } });
    expect((await w.run(job(full)))!.summary).toBe('3 steps · 1 AI step · notify: "sent"');
    const two = wire({ answers: { "apply-triage": [okAnswer({}, { requestAi: { input: {} } }), okAnswer({})] }, last: { tool: "notify", resultSummary: "ok" } });
    expect((await two.run(job(full, { maxAi: 2 })))!.summary).toBe("4 steps · 2 AI steps · notify: ok");
    const none = wire({ last: null });
    expect((await none.run(job([{ tool: "notify" }])))!.summary).toBe("1 step");
  });

  it("every summary is one plain line of at most 300 characters", async () => {
    const w = wire({ answers: { "pr-ci": { ok: false, error: `bad\nline‮ ${"x".repeat(400)}` } } });
    const r = await w.run(job(full));
    expect(r!.summary.startsWith("pr-ci failed: bad line x")).toBe(true);
    expect(Array.from(r!.summary)).toHaveLength(300);
    expect(r!.summary).not.toMatch(/[\n‮]/);
  });

  it("tokens are the AI steps' tokens only; 0 without an AI step", async () => {
    const w = wire({ ai: [{ ok: true, value: TRIAGE, tokens: 1234 }] });
    expect((await w.run(job(full)))!.tokens).toBe(1234);
    const none = wire();
    expect((await none.run(job([{ tool: "pr-ci" }, { tool: "notify" }])))!.tokens).toBe(0);
  });

  it("writes one JobRunRecord of part 3's shape", async () => {
    const w = wire();
    const r = await w.run(job(full));
    expect(w.logged).toEqual([r]);
    expect(Object.keys(r!).sort()).toEqual(["endedAt", "job", "run", "scope", "startedAt", "status", "summary", "tokens", "trigger"]);
    expect(r).toMatchObject({ run: "r1", job: "sync", scope: null, trigger: "manual", status: "ok" });
    expect(Date.parse(r!.endedAt)).toBeGreaterThan(Date.parse(r!.startedAt));
    const needs = wire({ answers: { "apply-triage": okAnswer({}, { requestAi: { input: {} } }) } });
    const n = await needs.run(job(full, { onLimit: "triage-ci" }));
    expect(Object.keys(n!).sort()).toEqual(["action", "endedAt", "job", "run", "scope", "startedAt", "status", "summary", "tokens", "trigger"]);
  });

  it("writes one recipe usage row with toolSteps, aiSteps, ms and ok", async () => {
    const w = wire();
    const r = await w.run(job(full), undefined, "intro");
    expect(w.rows).toHaveLength(1);
    const ms = Date.parse(r!.endedAt) - Date.parse(r!.startedAt);
    expect(w.rows[0]).toStrictEqual({ job: "sync", run: "r1", scope: "intro", toolSteps: 3, aiSteps: 1, ms, ok: true });
    const failed = wire({ answers: { "pr-ci": { ok: false, error: "x" } } });
    await failed.run(job(full));
    expect(failed.rows).toStrictEqual([expect.objectContaining({ toolSteps: 1, aiSteps: 0, ok: false })]);
    expect(Object.hasOwn(failed.rows[0] as object, "scope")).toBe(false);
  });

  it("a recipe row that can't be written never fails the run", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const w = wire();
    w.deps.recordRecipe = async () => {
      throw new Error("disk full");
    };
    expect((await w.run(job(full)))!.status).toBe("ok");
    expect(err).toHaveBeenCalled();
  });

  it("writes a trace note per AI round", async () => {
    const w = wire({
      answers: { "apply-triage": [okAnswer({}, { requestAi: { input: {} } }), okAnswer({})] },
      ai: [
        { ok: true, value: TRIAGE, tokens: 1234 },
        { ok: false, error: "The AI step gave no valid output: it was not called", tokens: 9 },
      ],
    });
    await w.run(job(full, { maxAi: 2 }));
    expect(w.notes).toEqual([
      { tool: "step_output", caller: "job", job: "sync", run: "r1", text: "AI step: valid output · 1,234 tokens" },
      { tool: "step_output", caller: "job", job: "sync", run: "r1", text: "AI step: no valid output · 9 tokens" },
    ]);
  });

  it("goes through the gate's jobs slot and frees it however the run ends", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const held = await gate.acquire("jobs", { id: "other" });
    const w = wire({ gate });
    const running = w.run(job(full));
    await new Promise((r) => setTimeout(r, 5));
    expect(w.calls).toEqual([]);
    expect(gate.isQueued("job:r1")).toBe(true);
    held();
    expect((await running)!.status).toBe("ok");
    expect(gate.running("jobs")).toBe(0);
    // A failed run, and a registry that throws ("Could not run"), free it too.
    const failed = wire({ gate, answers: { "pr-ci": { ok: false, error: "x" } } });
    await failed.run(job(full));
    expect(gate.running("jobs")).toBe(0);
    vi.spyOn(console, "error").mockImplementation(() => {});
    const throws = wire({ gate, answers: { "pr-ci": () => Promise.reject(new Error("/Users/x/secret: host died")) } });
    const r = await throws.run(job(full));
    expect(r).toMatchObject({ status: "failed", summary: "Could not run" });
    expect(gate.running("jobs")).toBe(0);
  });

  it("a limits read that throws frees the gate's slot and fails the run Could not run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const w = wire();
    w.deps.limits = () => {
      throw new Error("/Users/x: no harness");
    };
    const r = await w.run(job(full));
    expect(r).toMatchObject({ status: "failed", summary: "Could not run" });
    expect(w.calls).toEqual([]);
    expect(w.gate.running("jobs")).toBe(0);
  });

  it("a gate that can't get ready (its beforeStart fails) gives Could not run, and no call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const gate = new TurnGate({ tasks: 1, jobs: 1 }, { hold: { singleSession: true } });
    gate.setBeforeStart(async () => {
      throw new Error("could not sleep the other lane");
    });
    const w = wire({ gate });
    const r = await w.run(job(full));
    expect(r).toMatchObject({ status: "failed", summary: "Could not run", tokens: 0 });
    expect(w.calls).toEqual([]);
    expect(w.logged).toEqual([r]);
    expect(gate.running("jobs")).toBe(0);
  });

  it("a run dropped before it starts logs nothing and returns null", async () => {
    const invalid = wire({ stillValid: async () => false });
    expect(await invalid.run(job(full))).toBeNull();
    expect(invalid.calls).toEqual([]);
    expect(invalid.logged).toEqual([]);
    expect(invalid.rows).toEqual([]);
    expect(invalid.gate.running("jobs")).toBe(0);

    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const held = await gate.acquire("jobs", { id: "other" });
    const dropped = wire({ gate });
    const running = dropped.run(job(full));
    await new Promise((r) => setTimeout(r, 5));
    gate.drop("job:r1");
    expect(await running).toBeNull();
    held();
    expect(dropped.logged).toEqual([]);

    const aborted = wire();
    const ctl = new AbortController();
    ctl.abort();
    expect(await aborted.run(job(full), ctl.signal)).toBeNull();
    expect(aborted.logged).toEqual([]);
  });

  it("an abort while queued takes the run out of the gate: null, nothing logged", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const held = await gate.acquire("jobs", { id: "other" });
    const w = wire({ gate });
    const ctl = new AbortController();
    const running = w.run(job(full), ctl.signal);
    await new Promise((r) => setTimeout(r, 5));
    ctl.abort();
    expect(await running).toBeNull();
    expect(gate.isQueued("job:r1")).toBe(false);
    held();
  });

  it("the time limit ends the run Timed out after the running call; no later step starts", async () => {
    const slow = () => new Promise<ToolAnswer>((r) => setTimeout(() => r(okAnswer([{ failed: true }])), 80));
    const w = wire({ answers: { "pr-ci": slow }, maxMs: 20 });
    const r = await w.run(job(full));
    expect(r).toMatchObject({ status: "failed", summary: "Timed out", tokens: 0 });
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci"]);
    expect(w.aiCalls).toEqual([]);
    expect(w.rows).toStrictEqual([expect.objectContaining({ toolSteps: 1, ok: false })]);
    expect(w.gate.running("jobs")).toBe(0);
  });

  it("the time limit cancels a running AI step at once: Timed out, its tokens kept", async () => {
    const hang = (o: AiCall) =>
      new Promise<AiStepResult>((resolve) => o.signal!.addEventListener("abort", () => resolve({ ok: false, error: "Cancelled", cancelled: true, tokens: 7 })));
    const w = wire({ ai: [hang], maxMs: 30 });
    const r = await w.run(job(full));
    expect(r).toMatchObject({ status: "failed", summary: "Timed out", tokens: 7 });
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci"]);
  });

  it("an abort ends the run Cancelled and cancels a running AI step", async () => {
    const ctl = new AbortController();
    let signal: AbortSignal | undefined;
    const hang = (o: AiCall) => {
      signal = o.signal;
      setTimeout(() => ctl.abort(), 5);
      return new Promise<AiStepResult>((resolve) => o.signal!.addEventListener("abort", () => resolve({ ok: false, error: "Cancelled", cancelled: true, tokens: 3 })));
    };
    const w = wire({ ai: [hang] });
    const r = await w.run(job(full), ctl.signal);
    expect(signal!.aborted).toBe(true);
    expect(r).toMatchObject({ status: "failed", summary: "Cancelled", tokens: 3 });
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci"]);
    expect(w.notes).toHaveLength(1);
    expect(w.gate.running("jobs")).toBe(0);
  });

  it("an abort during a tool call lets it end, then starts nothing more", async () => {
    const ctl = new AbortController();
    const slow = () => {
      setTimeout(() => ctl.abort(), 5);
      return new Promise<ToolAnswer>((r) => setTimeout(() => r(okAnswer(RED)), 30));
    };
    const w = wire({ answers: { "pr-ci": slow } });
    const r = await w.run(job(full), ctl.signal);
    expect(r).toMatchObject({ status: "failed", summary: "Cancelled" });
    expect(w.calls.map((c) => c.tool)).toEqual(["pr-ci"]);
    expect(w.aiCalls).toEqual([]);
  });

  it("a recipe with no AI step runs every tool step and never calls the AI", async () => {
    const w = wire({ last: { tool: "notify", resultSummary: "x" } });
    const r = await w.run(job([{ tool: "pr-ci", as: "ci" }, { tool: "apply-triage", input: ["ci"] }, { tool: "notify" }]));
    expect(w.calls.map((c) => [c.tool, c.post])).toEqual([
      ["pr-ci", undefined],
      ["apply-triage", undefined],
      ["notify", undefined],
    ]);
    expect(w.aiCalls).toEqual([]);
    expect(r).toMatchObject({ status: "ok", summary: "3 steps · notify: x", tokens: 0 });
  });
});
