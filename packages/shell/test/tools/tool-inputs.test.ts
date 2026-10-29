import type { ToolMeta } from "@humanharness/harness-sdk";
import { describe, expect, it } from "vitest";
import { ToolRegistry, type ToolRegistryDeps } from "../../src/main/tools/tool-registry";
import type { TraceEntry } from "../../src/main/tools/tool-trace";

const TASK = "0b9f3c1e-5a2d-4c6b-9e8f-1a2b3c4d5e6f";

const meta = (over: Partial<ToolMeta> = {}): ToolMeta => ({
  description: "Lists what is due today in the open scope",
  agent: "call",
  uses: {},
  params: { type: "object", properties: {} },
  timeout: 30,
  file: "tools/due-today.js",
  ...over,
});

function registry(o: { off?: string } = {}) {
  const seen = { calls: [] as Parameters<ToolRegistryDeps["host"]["call"]>[0][], entries: [] as TraceEntry[] };
  const tools = { "due-today": meta() };
  const deps: ToolRegistryDeps = {
    json: async () => (o.off ? { on: false, reason: o.off } : { on: true, tools }),
    host: { call: async (c) => (seen.calls.push(c), { ok: true, value: [1] }), off: () => null },
    broker: () => ({ startCall: () => ({ id: "run-1", signal: new AbortController().signal }), endCall: () => ({ accesses: [], logs: [] }) }),
    trace: { append: async (e) => void seen.entries.push(e) },
    secretValues: async () => [],
    now: () => new Date("2026-10-29T10:00:00.000Z"),
  };
  return { r: new ToolRegistry(deps), seen, tools };
}

describe("inputs (tools spec §4.2 ctx.inputs)", () => {
  it("a call's inputs reach the host with the call", async () => {
    const { r, seen } = registry();
    const a = await r.call({ tool: "due-today", args: {}, caller: "pre", scope: "s1", task: TASK, inputs: { today: [1] } });
    expect(a).toEqual({ ok: true, result: [1] });
    expect(seen.calls).toEqual([{ callId: "run-1", tool: "due-today", args: {}, scope: "s1", inputs: { today: [1] } }]);
  });

  it("a call without inputs sends no inputs key (the host script gives ctx.inputs = {}) and traces as before", async () => {
    const { r, seen } = registry();
    await r.call({ tool: "due-today", args: {}, caller: "agent", scope: null, task: TASK });
    expect(seen.calls[0]).not.toHaveProperty("inputs");
    expect(seen.entries[0]).toEqual({
      at: "2026-10-29T10:00:00.000Z",
      tool: "due-today",
      caller: "agent",
      task: TASK,
      args: {},
      result: [1],
      resultSummary: "1 item",
      ms: 0,
      ok: true,
      accesses: [],
    });
  });

  it("the trace entry of a call with inputs never carries them", async () => {
    const { r, seen } = registry();
    await r.call({ tool: "due-today", args: {}, caller: "pre", scope: null, task: TASK, inputs: { today: ["secret-ish"] } });
    expect(seen.entries[0]).not.toHaveProperty("inputs");
    expect(JSON.stringify(seen.entries[0])).not.toContain("secret-ish");
  });

  it("inputs over 8 MB are refused before the host is asked", async () => {
    const { r, seen } = registry();
    const a = await r.call({ tool: "due-today", args: {}, caller: "pre", scope: null, task: TASK, inputs: { big: "x".repeat(8 * 1024 * 1024) } });
    expect(a).toEqual({ ok: false, error: "The inputs are too large" });
    expect(seen.calls).toHaveLength(0);
    expect(seen.entries[0]).toMatchObject({ ok: false, error: "The inputs are too large" });
  });

  it("inputs JSON can't hold are refused before the host is asked", async () => {
    const { r, seen } = registry();
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    const a = await r.call({ tool: "due-today", args: {}, caller: "pre", scope: null, task: TASK, inputs: { loop } });
    expect(a).toEqual({ ok: false, error: "The inputs can't be sent" });
    expect(seen.calls).toHaveLength(0);
  });

  it("meta(id) is the tools.json entry", async () => {
    const { r, tools } = registry();
    expect(await r.meta("due-today")).toBe(tools["due-today"]);
  });

  it("meta(id) is null for an unknown id, an inherited key or a non-id", async () => {
    const { r } = registry();
    expect(await r.meta("nope")).toBeNull();
    expect(await r.meta("constructor")).toBeNull();
    expect(await r.meta("../x")).toBeNull();
  });

  it("meta(id) is null while tools are off", async () => {
    const { r } = registry({ off: "Tools are off" });
    expect(await r.meta("due-today")).toBeNull();
  });
});
