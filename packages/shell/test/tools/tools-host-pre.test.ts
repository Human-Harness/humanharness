import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PreStep, ToolMeta } from "@humanharness/harness-sdk";
import type { Event, ToolCallView } from "@humanharness/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolDataCall } from "../../src/main/data-requests";
import { PREPARE_FAILED } from "../../src/main/task-manager";
import type { ToolChannel, ToolHostAnswer, ToolHostCall } from "../../src/main/tools/tool-host";
import { ToolTrace } from "../../src/main/tools/tool-trace";
import { type ToolsHarness, type ToolsHostDeps, createToolsHost } from "../../src/main/tools/tools-host";
import type { UsageRecord } from "../../src/main/usage-log";

const TASK = randomUUID();
const AGENT_TASK = randomUUID();

let root: string;
let base: string;
let userData: string;

beforeEach(async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tools-pre-")));
  root = path.join(tmp, "harness");
  base = path.join(tmp, "base");
  userData = path.join(tmp, "user-data");
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.mkdir(base);
});
const pumps: ReturnType<typeof setInterval>[] = [];
afterEach(async () => {
  for (const p of pumps.splice(0)) clearInterval(p);
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

function meta(id: string, over: Partial<ToolMeta> = {}): ToolMeta {
  return {
    description: `Tool ${id} that does something useful`,
    agent: "call",
    uses: {},
    params: { type: "object", properties: { n: { type: "integer" } } },
    timeout: 30,
    file: `tools/${id}.js`,
    ...over,
  };
}

const TOOLS: Record<string, ToolMeta> = {
  count: meta("count"),
  write: meta("write", { uses: { data: { write: ["notes"] } } }),
  apply: meta("apply"),
};

async function built(): Promise<void> {
  await fs.writeFile(path.join(root, "dist", "tools.json"), JSON.stringify({ version: 1, tools: TOOLS }));
}

type Actions = NonNullable<ToolsHarness["actions"]>;

const ACTIONS: Actions = {
  draft: {
    pre: [{ tool: "count", as: "counts" }],
    phases: [
      { id: "outline", label: "Outline" },
      { id: "close", label: "Close", expects: ["count", "apply"] },
    ],
  },
};

function harness(actions: Actions): ToolsHarness {
  return {
    id: "notes",
    root,
    permissions: { edit: "folder", exec: false, web: false },
    data: { notes: { label: "Notes", agent: "read" } } as never,
    tools: Object.fromEntries(Object.keys(TOOLS).map((t) => [t, `./tools/${t}.ts`])),
    actions,
  };
}

type Answer = (c: ToolHostCall, channel: ToolChannel) => Promise<ToolHostAnswer>;

function wire(o: { actions?: Actions; answer?: Answer; scoped?: boolean; over?: Partial<ToolsHostDeps> } = {}) {
  const seen = {
    calls: [] as ToolHostCall[],
    data: [] as { request: unknown; call: ToolDataCall }[],
    events: [] as { task: string; event: Event }[],
    usage: [] as UsageRecord[],
    logs: [] as string[],
    bases: 0,
  };
  let channel: ToolChannel | null = null;
  const page: (() => void)[] = [];
  const pump = setInterval(() => page.splice(0).forEach((run) => run()), 1);
  pumps.push(pump);
  const deps: ToolsHostDeps = {
    harness: harness(o.actions ?? ACTIONS),
    base: async () => (seen.bases++, base),
    references: async () => [],
    userData,
    store: { harnessValues: async () => ({}) },
    data: async (request, call) => (seen.data.push({ request, call }), { ok: true }),
    exec: { resolve: async () => null, run: (() => Promise.reject(new Error("no"))) as never, env: async () => ({}) },
    fetch: (() => Promise.reject(new Error("no network"))) as never,
    allowHost: async () => false,
    host: {
      start: (p) => {
        channel = p.channel;
      },
      stop: () => undefined,
      call: (c) => {
        seen.calls.push(c);
        if (!o.answer) return Promise.resolve({ ok: true, value: [1, 2] });
        return new Promise<ToolHostAnswer>((resolve) => page.push(() => void o.answer!(c, channel!).then(resolve)));
      },
      off: () => null,
    },
    openScope: async () => "intro",
    slotTask: async (key) => (key === "main" ? { id: AGENT_TASK, scope: "intro", trailer: { task: AGENT_TASK, action: "draft", scope: "intro", phase: "outline" } } : null),
    jobRun: () => null,
    emitToTask: (task, event) => void seen.events.push({ task, event }),
    usage: async (r) => void seen.usage.push(r),
    engine: async () => "claude",
    scoped: () => o.scoped ?? true,
    log: (m) => void seen.logs.push(m),
    ...o.over,
  };
  return { t: createToolsHost(deps), seen };
}

async function traceLines(id: string): Promise<Record<string, unknown>[]> {
  const text = await fs.readFile(path.join(base, ".harness", "trace", `${id}.jsonl`), "utf8");
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

const withPre = (pre: PreStep[], preTokens?: number): Actions => ({ draft: { pre, ...(preTokens !== undefined ? { preTokens } : {}), phases: ACTIONS.draft!.phases } });

describe("toolsHost.prepare (tools spec §6)", () => {
  it("runs the action's pre-steps and answers the section, items and views", async () => {
    await built();
    const { t, seen } = wire();
    const a = await t.prepare({ action: "draft", scope: "intro", task: TASK, phase: "outline" });
    expect(a.failed).toBeUndefined();
    expect(a.text).toContain("## Prepared data");
    expect(a.text).toContain("### counts · count");
    expect(a.text).toContain("Tool count that does something useful");
    expect(a.text).toContain("[1,2]");
    expect(a.items).toEqual([expect.objectContaining({ kind: "prepared", id: "prepared:counts" })]);
    expect(a.views).toEqual([expect.objectContaining({ tool: "count", caller: "pre", ok: true })]);
    // The call itself: caller "pre", the task's scope as is, its task and phase.
    expect(seen.calls).toEqual([expect.objectContaining({ tool: "count", scope: "intro" })]);
    const [entry] = await traceLines(TASK);
    expect(entry).toMatchObject({ tool: "count", caller: "pre", task: TASK, phase: "outline", ok: true });
  });

  it("passes the task's scope as is (_app and main included), as an agent call does", async () => {
    await built();
    const { t, seen } = wire();
    await t.prepare({ action: "draft", scope: "_app", task: TASK });
    await t.prepare({ action: "draft", scope: "main", task: randomUUID() });
    expect(seen.calls.map((c) => c.scope)).toEqual(["_app", "main"]);
  });

  it("a pre-step's data write carries the task's own trailer (task, action, scope, phase)", async () => {
    await built();
    const answer: Answer = async (c, channel) => {
      const r = await channel.ctx(c.tool, c.callId, "data.put", ["notes", { key: "a", text: "x" }]);
      return r.ok ? { ok: true, value: "done" } : { ok: false, error: r.refused };
    };
    const { t, seen } = wire({ actions: withPre([{ tool: "write", as: "written" }]), answer });
    const a = await t.prepare({ action: "draft", scope: "intro", task: TASK, phase: "outline" });
    expect(a.failed).toBeUndefined();
    expect(seen.data).toEqual([
      { request: { op: "put", collection: "notes", record: { key: "a", text: "x" } }, call: { scope: "intro", tool: "write", trailer: { task: TASK, action: "draft", scope: "intro", phase: "outline" } } },
    ]);
    // Without scopes the trailer has no scope (as the task's own commits); without a phase, no phase.
    const unscoped = wire({ actions: withPre([{ tool: "write", as: "written" }]), answer, scoped: false });
    await unscoped.t.prepare({ action: "draft", scope: "main", task: TASK });
    expect(unscoped.seen.data[0]!.call.trailer).toEqual({ task: TASK, action: "draft" });
    expect(t.openRuns()).toBe(0);
  });

  it("cuts to the action's preTokens (default 4000) and writes one trace note per cut", async () => {
    await built();
    const big = Array.from({ length: 3000 }, (_, i) => `item-${i}`);
    const answer: Answer = async () => ({ ok: true, value: big });
    // Default 4000 tokens: 3000 items of ~9 characters don't fit.
    const def = wire({ answer });
    const a = await def.t.prepare({ action: "draft", scope: "intro", task: TASK, phase: "outline" });
    expect(a.text.length).toBeLessThanOrEqual(4000 * 4);
    expect(a.text.length).toBeGreaterThan(500 * 4);
    const lines = await traceLines(TASK);
    const notes = lines.filter((l) => l.note !== undefined);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ tool: "count", caller: "pre", task: TASK, phase: "outline" });
    expect(notes[0]!.note).toMatch(/^counts: cut: \d+ of 3000 items$/);
    // The note comes after the call, in the same group.
    expect(a.views.map((v) => (v.note !== undefined ? "note" : v.tool))).toEqual(["count", "note"]);
    // A smaller cap from the action.
    const small = wire({ actions: withPre([{ tool: "count", as: "counts" }], 500), answer });
    const id = randomUUID();
    const b = await small.t.prepare({ action: "draft", scope: "intro", task: id });
    expect(b.text.length).toBeLessThanOrEqual(500 * 4);
    expect((await traceLines(id)).filter((l) => l.note !== undefined)).toHaveLength(1);
    expect(def.seen.events).toEqual([]);
  });

  it("a section with no text left still sends its cuts to the trace and adds no context part", async () => {
    await built();
    const answer: Answer = async () => ({ ok: true, value: "x".repeat(400) });
    // Ten long `as` ids whose headers alone don't fit 500 tokens: every block is dropped.
    const steps: PreStep[] = Array.from({ length: 10 }, (_, i) => ({ tool: "count", as: `${"a".repeat(60)}${i}` }));
    const { t } = wire({ actions: withPre(steps, 1), answer });
    const a = await t.prepare({ action: "draft", scope: "intro", task: TASK });
    expect(a.text).toBe("");
    expect(a.items).toEqual([]);
    const notes = (await traceLines(TASK)).filter((l) => l.note !== undefined);
    expect(notes.length).toBeGreaterThan(0);
    expect(a.views.filter((v) => v.note !== undefined)).toHaveLength(notes.length);
  });

  it("writes one pre row: steps, ms, preparedTokens, ok", async () => {
    await built();
    const { t, seen } = wire({ actions: withPre([{ tool: "count", as: "counts" }, { tool: "apply" }]) });
    const a = await t.prepare({ action: "draft", scope: "intro", task: TASK, phase: "outline" });
    expect(seen.usage).toHaveLength(1);
    const [row] = seen.usage;
    expect(row).toMatchObject({ engine: "claude", kind: "pre", action: "draft", task: TASK, scope: "intro", steps: 2, ok: true, preparedTokens: Math.ceil(a.text.length / 4) });
    expect(typeof row!.ms).toBe("number");
    // Ids only: no step message, no phase.
    expect(Object.keys(row!).sort()).toEqual(["action", "at", "engine", "kind", "ms", "ok", "preparedTokens", "scope", "steps", "task"]);
    // Without scopes the row has none.
    const unscoped = wire({ scoped: false });
    await unscoped.t.prepare({ action: "draft", scope: "main", task: randomUUID() });
    expect(unscoped.seen.usage[0]).not.toHaveProperty("scope");
  });

  it("a required failure answers failed '<tool> failed: <message>' and writes the row with ok false", async () => {
    await built();
    const answer: Answer = async (c) => (c.tool === "apply" ? { ok: false, error: "the folder is gone" } : { ok: true, value: [1] });
    const { t, seen } = wire({ actions: withPre([{ tool: "apply", as: "applied", required: true }, { tool: "count" }]), answer });
    const a = await t.prepare({ action: "draft", scope: "intro", task: TASK });
    expect(a).toMatchObject({ text: "", items: [], failed: "apply failed: the folder is gone" });
    expect(a.views).toEqual([expect.objectContaining({ tool: "apply", caller: "pre", ok: false })]);
    expect(seen.calls.map((c) => c.tool)).toEqual(["apply"]);
    expect(seen.usage).toEqual([expect.objectContaining({ kind: "pre", steps: 2, ok: false })]);
    expect(JSON.stringify(seen.usage)).not.toContain("folder is gone");
    // A failed step that isn't required: its block says so, the start goes on, the row is ok false.
    const loose = wire({ actions: withPre([{ tool: "apply", as: "applied" }, { tool: "count" }]), answer });
    const b = await loose.t.prepare({ action: "draft", scope: "intro", task: randomUUID() });
    expect(b.failed).toBeUndefined();
    expect(b.text).toContain("apply failed: the folder is gone");
    expect(loose.seen.usage).toEqual([expect.objectContaining({ ok: false })]);
  });

  it("a failed start's calls stay readable under its id and are pruned by age like any task's", async () => {
    await built();
    const answer: Answer = async () => ({ ok: false, error: "no" });
    const { t } = wire({ actions: withPre([{ tool: "apply", required: true }]), answer });
    const a = await t.prepare({ action: "draft", scope: "intro", task: TASK });
    expect(a.failed).toBe("apply failed: no");
    // The id never reaches tasks.json: the trace still reads it, and the prune drops it by age alone.
    expect(await t.trace(TASK)).toEqual([expect.objectContaining({ tool: "apply", caller: "pre", ok: false })]);
    await new ToolTrace({ base, now: () => new Date(Date.now() + 31 * 24 * 60 * 60_000) }).prune();
    await expect(fs.access(path.join(base, ".harness", "trace", `${TASK}.jsonl`))).rejects.toThrow();
  });

  it("tools off: every step fails with the off reason, and a required one stops the start", async () => {
    // No tools.json: tools are off.
    const { t, seen } = wire({ actions: withPre([{ tool: "count", as: "counts" }, { tool: "apply", required: true }]) });
    const a = await t.prepare({ action: "draft", scope: "intro", task: TASK });
    expect(seen.calls).toEqual([]);
    expect(a.failed).toMatch(/^apply failed: .+/);
    const reason = a.failed!.slice("apply failed: ".length);
    // Calls with tools off aren't traced (slice 2): no line to show.
    expect(a.views).toEqual([]);
    expect(seen.usage).toEqual([expect.objectContaining({ kind: "pre", ok: false })]);
    // Not required: each block says the off reason, and the start goes on.
    const loose = wire({ actions: withPre([{ tool: "count", as: "counts" }]) });
    const b = await loose.t.prepare({ action: "draft", scope: "intro", task: randomUUID() });
    expect(b.failed).toBeUndefined();
    expect(b.text).toContain(`count failed: ${reason}`);
  });

  it("a throw from the run is a failed start with the fixed text, never the thrown message", async () => {
    await built();
    const { t, seen } = wire();
    t.registry.call = () => Promise.reject(new Error("/Users/someone/secret path"));
    const a = await t.prepare({ action: "draft", scope: "intro", task: TASK });
    expect(a).toEqual({ text: "", items: [], views: [], failed: PREPARE_FAILED });
    expect(JSON.stringify(a)).not.toContain("secret");
    expect(seen.logs.some((l) => l.includes("pre-steps"))).toBe(true);
  });

  it("pre calls are not emitted to the task live; agent and UI calls still are", async () => {
    await built();
    const { t, seen } = wire();
    await t.prepare({ action: "draft", scope: "intro", task: TASK, phase: "outline" });
    expect(seen.events).toEqual([]);
    const ws = (await t.workspaceOptions())!;
    await ws.request({ tool: "count", args: {} }, { key: "main" });
    await t.uiCall("count", {});
    expect(seen.events).toEqual([{ task: AGENT_TASK, event: { type: "tool-call", call: expect.objectContaining({ tool: "count", caller: "agent" }) } }]);
    // A later prepare doesn't take in another task's agent calls.
    const b = await t.prepare({ action: "draft", scope: "intro", task: randomUUID() });
    expect(b.views.every((v: ToolCallView) => v.caller === "pre")).toBe(true);
  });
});

describe("toolsHost.phaseEnded (tools spec §6.1)", () => {
  it("reads the task's trace and writes one expects-miss row and one note per miss", async () => {
    await built();
    const { t, seen } = wire();
    const ws = (await t.workspaceOptions())!;
    // The agent calls count in Outline only; Close expects count and apply.
    await ws.request({ tool: "count", args: {} }, { key: "main" });
    seen.events.length = 0;
    await t.phaseEnded({ task: AGENT_TASK, action: "draft", scope: "intro", phase: "close" });
    expect(seen.usage).toEqual([
      expect.objectContaining({ engine: "claude", kind: "expects-miss", action: "draft", task: AGENT_TASK, scope: "intro", taskPhase: "close", tool: "count", ok: true }),
      expect.objectContaining({ kind: "expects-miss", taskPhase: "close", tool: "apply" }),
    ]);
    for (const r of seen.usage) expect(Object.keys(r).sort()).toEqual(["action", "at", "engine", "kind", "ok", "scope", "task", "taskPhase", "tool"]);
    const notes = (await traceLines(AGENT_TASK)).filter((l) => l.note !== undefined);
    expect(notes).toEqual([
      expect.objectContaining({ tool: "count", caller: "agent", task: AGENT_TASK, phase: "close", note: "Expected count in Close: not called" }),
      expect.objectContaining({ tool: "apply", caller: "agent", task: AGENT_TASK, phase: "close", note: "Expected apply in Close: not called" }),
    ]);
    // The notes reach the task's chat as any agent call does.
    expect(seen.events.map((e) => [e.task, (e.event as { call: ToolCallView }).call.note])).toEqual([
      [AGENT_TASK, "Expected count in Close: not called"],
      [AGENT_TASK, "Expected apply in Close: not called"],
    ]);
  });

  it("no miss: nothing written", async () => {
    await built();
    // The agent's calls in the closing part (its slot's phase): both expected tools, one of them failed.
    const close = { id: AGENT_TASK, scope: "intro", trailer: { task: AGENT_TASK, action: "draft", scope: "intro", phase: "close" } };
    const answer: Answer = async (c) => (c.tool === "apply" ? { ok: false, error: "no" } : { ok: true, value: 1 });
    const { t, seen } = wire({ answer, over: { slotTask: async () => close } });
    const ws = (await t.workspaceOptions())!;
    await ws.request({ tool: "count", args: {} }, { key: "main" });
    await expect(ws.request({ tool: "apply", args: {} }, { key: "main" })).rejects.toThrow();
    const before = (await traceLines(AGENT_TASK)).length;
    seen.events.length = 0;
    await t.phaseEnded({ task: AGENT_TASK, action: "draft", scope: "intro", phase: "close" });
    expect(seen.usage).toEqual([]);
    expect(seen.events).toEqual([]);
    expect(await traceLines(AGENT_TASK)).toHaveLength(before);
  });

  it("a part without expects reads nothing", async () => {
    await built();
    const { t, seen } = wire();
    await t.start();
    const bases = seen.bases;
    await t.phaseEnded({ task: AGENT_TASK, action: "draft", scope: "intro", phase: "outline" });
    await t.phaseEnded({ task: AGENT_TASK, action: "nope", scope: "intro", phase: "close" });
    await t.phaseEnded({ task: AGENT_TASK, action: "draft", scope: "intro", phase: "gone" });
    expect(seen.bases).toBe(bases);
    expect(seen.usage).toEqual([]);
    await expect(fs.access(path.join(base, ".harness", "trace", `${AGENT_TASK}.jsonl`))).rejects.toThrow();
  });

  it("without scopes the rows carry no scope", async () => {
    await built();
    const { t, seen } = wire({ scoped: false });
    await t.phaseEnded({ task: AGENT_TASK, action: "draft", scope: "main", phase: "close" });
    expect(seen.usage).toHaveLength(2);
    for (const r of seen.usage) expect(r).not.toHaveProperty("scope");
  });
});
