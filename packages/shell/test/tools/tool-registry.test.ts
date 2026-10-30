import type { ToolMeta } from "@humanharness/harness-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TOOL_BROKER_LIMITS, type TraceAccess, type TraceLog } from "../../src/main/tools/tool-broker";
import { TRACE_CUT, ToolRegistry, type ToolRegistryDeps } from "../../src/main/tools/tool-registry";
import type { TraceEntry } from "../../src/main/tools/tool-trace";

const SECRET = "tok-SECRET-1234";
const TASK = "0b9f3c1e-5a2d-4c6b-9e8f-1a2b3c4d5e6f";

function meta(over: Partial<ToolMeta> = {}): ToolMeta {
  return {
    description: "Counts the notes of the open scope",
    agent: "call",
    uses: {},
    params: { type: "object", properties: { folder: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } }, required: ["folder"] },
    timeout: 30,
    file: "tools/count.js",
    ...over,
  };
}

type HostAnswer = Awaited<ReturnType<ToolRegistryDeps["host"]["call"]>>;

function registry(o: { tools?: Record<string, ToolMeta>; answer?: (tool: string, args: unknown) => HostAnswer | Promise<HostAnswer>; off?: string; accesses?: TraceAccess[]; logs?: TraceLog[] } = {}) {
  const seen = {
    calls: [] as { callId: string; tool: string; args: unknown; scope: string | null; timeoutMs: number }[],
    started: [] as (string | null)[],
    limits: [] as unknown[],
    ended: [] as string[],
    entries: [] as TraceEntry[],
    called: [] as TraceEntry[],
  };
  const tools = o.tools ?? { count: meta() };
  let n = 0;
  const deps: ToolRegistryDeps = {
    json: async () => (o.off ? { on: false, reason: o.off } : { on: true, tools }),
    host: {
      call: async (c, timeoutMs) => (seen.calls.push({ ...c, timeoutMs }), o.answer ? o.answer(c.tool, c.args) : { ok: true, value: [1, 2, 3] }),
      off: () => null,
    },
    broker: () => ({
      startCall: (scope, limits) => (seen.started.push(scope), seen.limits.push(limits), { id: `run-${++n}`, signal: new AbortController().signal }),
      endCall: (id) => (seen.ended.push(id), { accesses: o.accesses ?? [], logs: o.logs ?? [] }),
    }),
    trace: { append: async (e) => void seen.entries.push(e) },
    secretValues: async () => [SECRET],
    called: (e) => void seen.called.push(e),
  };
  return { r: new ToolRegistry(deps), seen, deps };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ToolRegistry (tools spec §4.3)", () => {
  it("valid arguments: the host runs the tool with a fresh broker run's id, the scope and the tool's timeout", async () => {
    const { r, seen } = registry();
    const a = await r.call({ tool: "count", args: { folder: "notes" }, caller: "ui", scope: "s1" });
    expect(a).toEqual({ ok: true, result: [1, 2, 3] });
    expect(seen.started).toEqual(["s1"]);
    expect(seen.calls).toEqual([{ callId: "run-1", tool: "count", args: { folder: "notes" }, scope: "s1", timeoutMs: 30_000 }]);
    expect(seen.ended).toEqual(["run-1"]);
  });

  it("a job run's limits reach the broker run the call starts; a call without them starts one without", async () => {
    const { r, seen } = registry();
    const limits = { job: "digest", web: false, exec: true };
    await r.call({ tool: "count", args: { folder: "n" }, caller: "agent", scope: "s1", job: "digest", run: TASK, limits });
    await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(seen.limits).toEqual([limits, undefined]);
    // The trace keeps the job and run as before; the limits are not a trace field.
    expect(seen.entries[0]).not.toHaveProperty("limits");
  });

  it("invalid arguments: the tool does not run; the caller gets the validation error", async () => {
    const { r, seen } = registry();
    const a = await r.call({ tool: "count", args: { folder: "notes", limit: 99 }, caller: "agent", scope: null, task: TASK });
    expect(a.ok).toBe(false);
    expect(!a.ok && a.error).toMatch(/^limit: /);
    expect(seen.calls).toHaveLength(0);
    expect(seen.started).toHaveLength(0);
    expect(seen.entries).toHaveLength(1);
    expect(seen.entries[0]).toMatchObject({ ok: false, error: a.ok ? "" : a.error, accesses: [] });
  });

  it("an extra argument key never reaches run: the parsed value is what the host gets", async () => {
    const { r, seen } = registry();
    const a = await r.call({ tool: "count", args: { folder: "notes", extra: "sneaky" }, caller: "ui", scope: null });
    expect(a.ok).toBe(true);
    expect(seen.calls[0]!.args).toEqual({ folder: "notes" });
  });

  it("arguments JSON can't hold are traced as such, never thrown", async () => {
    const { r, seen } = registry();
    const args: Record<string, unknown> = { folder: 1 };
    args.self = args;
    expect((await r.call({ tool: "count", args, caller: "ui", scope: null })).ok).toBe(false);
    expect(seen.entries[0]!.args).toEqual({ cut: true, text: "(not JSON)" });
  });

  it("no arguments are {}", async () => {
    const { r, seen } = registry({ tools: { ping: meta({ params: { type: "object", properties: {} } }) } });
    expect((await r.call({ tool: "ping", args: undefined, caller: "ui", scope: null })).ok).toBe(true);
    expect(seen.calls[0]!.args).toEqual({});
  });

  it("a result that does not match returns fails with the first mismatch", async () => {
    const returns = { type: "object", properties: { count: { type: "integer" } }, required: ["count"], additionalProperties: false };
    const { r } = registry({ tools: { count: meta({ returns }) }, answer: () => ({ ok: true, value: { count: "three" } }) });
    const a = await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(a).toEqual({ ok: false, error: expect.stringMatching(/^The result doesn't match returns: count: /) });
  });

  it("a result with a key returns doesn't name is refused, never half-passed", async () => {
    const returns = { type: "object", properties: { count: { type: "integer" } }, required: ["count"], additionalProperties: false };
    const { r, seen } = registry({ tools: { count: meta({ returns }) }, answer: () => ({ ok: true, value: { count: 3, token: "x" } }) });
    const a = await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(a).toEqual({ ok: false, error: expect.stringMatching(/^The result doesn't match returns: .*token/) });
    expect(seen.entries[0]).toMatchObject({ ok: false });
    expect(seen.entries[0]!.result).toBeUndefined();
  });

  it("a result that matches returns passes", async () => {
    const returns = { type: "object", properties: { count: { type: "integer" } }, required: ["count"], additionalProperties: false };
    const { r } = registry({ tools: { count: meta({ returns }) }, answer: () => ({ ok: true, value: { count: 3 } }) });
    expect(await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null })).toEqual({ ok: true, result: { count: 3 } });
  });

  it("times out after 30 s by default and after the tool's timeout when set", async () => {
    vi.useFakeTimers();
    const { r, seen } = registry({
      tools: { count: meta(), slow: meta({ timeout: 5, params: { type: "object", properties: {} } }) },
      answer: () => new Promise<never>(() => {}),
    });
    const a = r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    const b = r.call({ tool: "slow", args: {}, caller: "ui", scope: null });
    let bDone = false;
    void b.then(() => (bDone = true));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(bDone).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await b).toEqual({ ok: false, error: "slow took longer than 5 s" });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await a).toEqual({ ok: false, error: "count took longer than 30 s" });
    expect(seen.calls.map((c) => c.timeoutMs)).toEqual([30_000, 5_000]);
    expect(seen.ended).toEqual(["run-2", "run-1"]);
  });

  it("an unknown id or an agent: none tool from the agent caller is refused", async () => {
    const { r, seen } = registry({ tools: { count: meta(), hidden: meta({ agent: "none" }) } });
    expect(await r.call({ tool: "nope", args: {}, caller: "agent", scope: null, task: TASK })).toEqual({ ok: false, error: 'Unknown tool "nope"' });
    expect(await r.call({ tool: "../x", args: {}, caller: "ui", scope: null })).toEqual({ ok: false, error: "Unknown tool" });
    expect(await r.call({ tool: "constructor", args: {}, caller: "ui", scope: null })).toEqual({ ok: false, error: 'Unknown tool "constructor"' });
    expect(await r.call({ tool: "hidden", args: { folder: "n" }, caller: "agent", scope: null, task: TASK })).toEqual({ ok: false, error: 'Unknown tool "hidden"' });
    expect(seen.calls).toHaveLength(0);
    expect(seen.entries).toHaveLength(0);
    // The UI may call it.
    expect((await r.call({ tool: "hidden", args: { folder: "n" }, caller: "ui", scope: null })).ok).toBe(true);
  });

  it("writes one trace entry per call: caller, task/job/run, args, resultSummary, ms, ok, accesses", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-29T12:00:00.000Z") });
    const accesses: TraceAccess[] = [{ kind: "fetch", target: "https://api.x.com/a", allowed: true }];
    const { r, seen } = registry({
      accesses,
      answer: async () => {
        await new Promise((ok) => setTimeout(ok, 250));
        return { ok: true, value: [1, 2] };
      },
    });
    const p = r.call({ tool: "count", args: { folder: "n" }, caller: "agent", scope: "s1", task: TASK, phase: "plan" });
    await vi.advanceTimersByTimeAsync(250);
    await p;
    const q = r.call({ tool: "count", args: { folder: "n" }, caller: "agent", scope: null, job: "nightly", run: "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f" });
    await vi.advanceTimersByTimeAsync(250);
    await q;
    expect(seen.entries[0]).toEqual({
      at: "2026-10-29T12:00:00.000Z",
      tool: "count",
      caller: "agent",
      task: TASK,
      phase: "plan",
      args: { folder: "n" },
      result: [1, 2],
      resultSummary: "2 items",
      ms: 250,
      ok: true,
      accesses,
    });
    expect(seen.entries[1]).toMatchObject({ job: "nightly", run: "7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f" });
    expect(seen.entries[1]!.task).toBeUndefined();
    expect(seen.called).toEqual(seen.entries);
  });

  it("a failing host answer is the call's error, traced with ok false", async () => {
    const { r, seen } = registry({ answer: () => ({ ok: false, error: "boom" }) });
    expect(await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null })).toEqual({ ok: false, error: "boom" });
    expect(seen.entries[0]).toMatchObject({ ok: false, error: "boom", resultSummary: "failed" });
  });

  it("a secret echoed back is redacted in the trace and the result's error", async () => {
    const { r, seen } = registry({
      accesses: [{ kind: "fetch", target: `https://api.x.com/?k=${SECRET}`, allowed: true }],
      answer: () => ({ ok: false, error: `bad token ${SECRET}` }),
    });
    const a = await r.call({ tool: "count", args: { folder: SECRET }, caller: "ui", scope: null });
    expect(a).toEqual({ ok: false, error: "bad token [redacted]" });
    const text = JSON.stringify(seen.entries);
    expect(text).not.toContain(SECRET);
    expect(seen.entries[0]).toMatchObject({ error: "bad token [redacted]", args: { folder: "[redacted]" } });
    expect(seen.entries[0]!.accesses[0]!.target).toBe("https://api.x.com/?k=[redacted]");
  });

  it("a key across the error's 4096-character cut is hidden before the cut, never kept half", async () => {
    const { r, seen } = registry({ answer: () => ({ ok: false, error: "x".repeat(4090) + SECRET }) });
    const a = await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(!a.ok && a.error).toBe("x".repeat(4090) + "[redac");
    expect(JSON.stringify(seen.entries)).not.toContain("tok-SE");
  });

  it("an error that arrived at the host's 16000 cap loses its tail, so a key the host cut never shows its start", async () => {
    // 31 hidden keys shrink 16000 characters to under 4096, so the half key the host's cut left would be kept.
    const key = `LONGKEY-${"q".repeat(492)}`;
    const { deps } = registry({ answer: () => ({ ok: false, error: key.repeat(32).slice(0, 16_000) }) });
    const r = new ToolRegistry({ ...deps, secretValues: async () => [key] });
    const a = await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(a).toEqual({ ok: false, error: "The tool failed; its error can't be shown" });
    // Short of the cap, nothing is dropped.
    const { r: r2 } = registry({ answer: () => ({ ok: false, error: `plain error ${SECRET}` }) });
    expect(await r2.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null })).toEqual({ ok: false, error: "plain error [redacted]" });
  });

  it("ctx.log lines go into the call's trace entry (spec §4.2), in order, and a call without one has no logs key", async () => {
    const { r, seen } = registry({ logs: [{ level: "warn", message: "slow page" }, { level: "info", message: "done" }] });
    await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(seen.entries[0]!.logs).toEqual([
      { level: "warn", message: "slow page" },
      { level: "info", message: "done" },
    ]);
    const plain = registry();
    await plain.r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(Object.hasOwn(plain.seen.entries[0]!, "logs")).toBe(false);
  });

  it("a key inside a log line is hidden, and one across the 300-character cut is hidden before the cut", async () => {
    const { r, seen } = registry({ logs: [{ level: "info", message: `token ${SECRET} sent` }, { level: "error", message: "x".repeat(295) + SECRET }] });
    await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(seen.entries[0]!.logs).toEqual([
      { level: "info", message: "token [redacted] sent" },
      { level: "error", message: `${"x".repeat(295)}[reda` },
    ]);
    expect(JSON.stringify(seen.entries)).not.toContain("tok-SE");
  });

  it("a log line that arrived at the broker's cap loses its tail, so a key the broker cut never shows its start", async () => {
    // Two hidden keys leave the start of the third, cut by the broker, inside the first 300 characters.
    const key = `LONGKEY-${"q".repeat(7992)}`;
    const { deps } = registry({ logs: [{ level: "info", message: key.repeat(3).slice(0, TOOL_BROKER_LIMITS.logLook) }] });
    const seen: TraceEntry[] = [];
    const r = new ToolRegistry({ ...deps, secretValues: async () => [key], trace: { append: async (e) => void seen.push(e) } });
    await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(seen[0]!.logs![0]!.message).not.toContain("LONGKEY");
    expect(seen[0]!.logs![0]!.message.length).toBeLessThanOrEqual(300);
  });

  it("a key across the summary's 200-character cut is hidden before the cut", async () => {
    const { r, seen } = registry({ answer: () => ({ ok: true, value: 1, summary: "s".repeat(195) + SECRET }) });
    await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(seen.entries[0]!.resultSummary).toBe("s".repeat(195) + "[reda");
  });

  it("a summary that arrived at the host's 16000 cap loses its tail before its 200 are kept", async () => {
    const key = `LONGKEY-${"q".repeat(15_792)}`;
    const { deps, seen } = registry({ answer: () => ({ ok: true, value: 1, summary: (key + key).slice(0, 16_000) }) });
    const r = new ToolRegistry({ ...deps, secretValues: async () => [key] });
    await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(seen.entries[0]!.resultSummary).not.toContain("LONGKEY");
  });

  it("a host call that throws answers 'Something went wrong running the tool' and still ends the run", async () => {
    const { deps, seen } = registry();
    const r = new ToolRegistry({
      ...deps,
      host: {
        off: () => null,
        call: () => {
          throw new Error("sync boom");
        },
      },
    });
    expect(await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null })).toEqual({ ok: false, error: "Something went wrong running the tool" });
    expect(seen.ended).toEqual(["run-1"]);
    const r2 = new ToolRegistry({ ...deps, host: { off: () => null, call: async () => Promise.reject(new Error("async boom")) } });
    expect(await r2.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null })).toEqual({ ok: false, error: "Something went wrong running the tool" });
    expect(seen.ended).toEqual(["run-1", "run-2"]);
  });

  it("an endCall that throws is logged; the call still answers and is traced", async () => {
    const { deps, seen } = registry();
    const logs: string[] = [];
    const r = new ToolRegistry({
      ...deps,
      log: (m) => void logs.push(m),
      broker: () => ({
        startCall: () => ({ id: "run-x", signal: new AbortController().signal }),
        endCall: () => {
          throw new Error("gone");
        },
      }),
    });
    expect(await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null })).toEqual({ ok: true, result: [1, 2, 3] });
    expect(seen.entries[0]).toMatchObject({ ok: true, accesses: [] });
    expect(logs).toHaveLength(1);
  });

  it("a secret in a result is hidden in the answer, the summary and the trace", async () => {
    const { r, seen } = registry({ answer: () => ({ ok: true, value: { echo: `got ${SECRET}` }, summary: `said ${SECRET}` }) });
    const a = await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect(a).toEqual({ ok: true, result: { echo: "got [redacted]" } });
    expect(JSON.stringify(seen.entries)).not.toContain(SECRET);
    expect(seen.entries[0]!.resultSummary).toBe("said [redacted]");
  });

  it("args and results are cut at 2 KB per entry in the trace, never in the answer", async () => {
    const big = "é".repeat(5000);
    const { r, seen } = registry({ answer: () => ({ ok: true, value: big }) });
    const a = await r.call({ tool: "count", args: { folder: big }, caller: "ui", scope: null });
    expect(a).toEqual({ ok: true, result: big });
    expect(TRACE_CUT).toBe(2048);
    const e = seen.entries[0]!;
    expect(e.args).toEqual({ cut: true, text: JSON.stringify({ folder: big }).slice(0, 2048) });
    expect(e.result).toEqual({ cut: true, text: JSON.stringify(big).slice(0, 2048) });
  });

  it("a key at the edge of a long value is never kept half in the cut", async () => {
    const pad = "a".repeat(2040);
    const { r, seen } = registry({ answer: () => ({ ok: true, value: pad + SECRET }) });
    await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
    expect((seen.entries[0]!.result as { text: string }).text).not.toContain("tok-SEC");
  });

  it("a key cut in half where huge arguments stop being read never shows its start", async () => {
    // 131 hidden keys shrink 64 KB to under 2 KB, so the key the read limit cuts would land inside the kept 2 KB.
    const key = `LONGKEY-${"q".repeat(492)}`;
    const { deps, seen } = registry();
    const r = new ToolRegistry({ ...deps, secretValues: async () => [key] });
    await r.call({ tool: "count", args: { folder: key.repeat(200) }, caller: "ui", scope: null });
    const e = seen.entries[0]!;
    expect(e.args).toMatchObject({ cut: true });
    expect(JSON.stringify(e)).not.toContain("LONGKEY");
  });

  it("resultSummary: the tool's summary(), else '12 items' / 'object with 4 keys' / 'text, 40 characters'", async () => {
    const values: [unknown, string | undefined, string][] = [
      [Array.from({ length: 12 }, (_, i) => i), undefined, "12 items"],
      [[1], undefined, "1 item"],
      [{ a: 1, b: 2, c: 3, d: 4 }, undefined, "object with 4 keys"],
      [{ a: 1 }, undefined, "object with 1 key"],
      ["x".repeat(40), undefined, "text, 40 characters"],
      [7, undefined, "7"],
      [null, undefined, "nothing"],
      [[1, 2], "2 open PRs", "2 open PRs"],
    ];
    for (const [value, summary, want] of values) {
      const { r, seen } = registry({ answer: () => ({ ok: true, value, ...(summary ? { summary } : {}) }) });
      await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null });
      expect(seen.entries[0]!.resultSummary).toBe(want);
    }
  });

  it("off: every call answers the off reason", async () => {
    const { r, seen } = registry({ off: "Tools are not built: run humanharness build" });
    expect(await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null })).toEqual({ ok: false, error: "Tools are not built: run humanharness build" });
    expect(await r.call({ tool: "nope", args: {}, caller: "agent", scope: null })).toEqual({ ok: false, error: "Tools are not built: run humanharness build" });
    expect(seen.calls).toHaveLength(0);
    expect(seen.entries).toHaveLength(0);
  });

  it("a host off after crashes answers its reason", async () => {
    const { deps, seen } = registry();
    const r = new ToolRegistry({ ...deps, host: { ...deps.host, off: () => "Tools are off after repeated crashes" } });
    expect(await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null })).toEqual({ ok: false, error: "Tools are off after repeated crashes" });
    expect(seen.calls).toHaveLength(0);
  });

  it("a trace that can't be written never fails the call", async () => {
    const { deps } = registry();
    const logs: string[] = [];
    const r = new ToolRegistry({ ...deps, trace: { append: async () => Promise.reject(new Error("disk full")) }, log: (m) => void logs.push(m) });
    expect(await r.call({ tool: "count", args: { folder: "n" }, caller: "ui", scope: null })).toEqual({ ok: true, result: [1, 2, 3] });
    expect(logs).toHaveLength(1);
  });
});
