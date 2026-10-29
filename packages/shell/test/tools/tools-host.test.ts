import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolMeta } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolDataCall } from "../../src/main/data-requests";
import { TOOLS_OFF_CRASHES } from "@humanharness/ui/client";
import { TOOLS_OFF, type ToolChannel, type ToolHostAnswer, type ToolHostCall } from "../../src/main/tools/tool-host";
import { TOOL_BROKE, type ToolsHarness, type ToolsHostDeps, TOOLS_OFF_ITEM, createToolsHost, slotTaskOf, toolCallView, toolExecEnv } from "../../src/main/tools/tools-host";

const TASK = randomUUID();
const RUN = randomUUID();
const SECRET = "tok-SECRET-98765";

let root: string;
let base: string;
let userData: string;

beforeEach(async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tools-host-")));
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
  hidden: meta("hidden", { agent: "none" }),
  write: meta("write", { uses: { data: { write: ["notes"] } } }),
  leak: meta("leak", { uses: { secrets: ["jira"] } }),
};

async function built(tools: Record<string, ToolMeta> = TOOLS): Promise<void> {
  await fs.writeFile(path.join(root, "dist", "tools.json"), JSON.stringify({ version: 1, tools }));
}

function harness(tools: Record<string, ToolMeta> = TOOLS, id = "notes"): ToolsHarness {
  return {
    id,
    root,
    permissions: { edit: "folder", exec: false, web: false },
    data: { notes: { label: "Notes", agent: "read" } } as never,
    secrets: [{ id: "jira", label: "Jira token" }] as never,
    tools: Object.fromEntries(Object.keys(tools).map((t) => [t, `./tools/${t}.ts`])),
  };
}

type Answer = (c: ToolHostCall, channel: ToolChannel) => Promise<ToolHostAnswer>;

function wire(o: { tools?: Record<string, ToolMeta>; answer?: Answer; harnessId?: string; startThrows?: Error; over?: Partial<ToolsHostDeps> } = {}) {
  const seen = {
    started: [] as { harnessId: string; dist: string; ids: readonly string[] }[],
    stopped: 0,
    calls: [] as ToolHostCall[],
    data: [] as { request: unknown; call: ToolDataCall }[],
    events: [] as { task: string; event: Event }[],
    logs: [] as string[],
  };
  let channel: ToolChannel | null = null;
  const page: (() => void)[] = [];
  const pump = setInterval(() => page.splice(0).forEach((run) => run()), 1);
  pumps.push(pump);
  const deps: ToolsHostDeps = {
    harness: harness(o.tools, o.harnessId),
    base: async () => base,
    references: async () => [],
    userData,
    store: { harnessValues: async (ids) => Object.fromEntries(ids.map((id) => [id, SECRET])) },
    data: async (request, call) => (seen.data.push({ request, call }), { ok: true }),
    exec: { resolve: async () => null, run: (() => Promise.reject(new Error("no"))) as never, env: async () => ({}) },
    fetch: (() => Promise.reject(new Error("no network"))) as never,
    allowHost: async () => false,
    host: {
      start: (p) => {
        if (o.startThrows) throw o.startThrows;
        seen.started.push({ harnessId: p.harnessId, dist: p.dist, ids: p.ids });
        channel = p.channel;
      },
      stop: () => void seen.stopped++,
      // The page runs the call and its ctx calls come back over IPC, out of main's call chain: the pump below, started
      // here and not inside any call, runs them as the IPC handler would.
      call: (c) => {
        seen.calls.push(c);
        if (!o.answer) return Promise.resolve({ ok: true, value: [1, 2] });
        return new Promise<ToolHostAnswer>((resolve) => page.push(() => void o.answer!(c, channel!).then(resolve)));
      },
      off: () => null,
    },
    openScope: async () => "intro",
    slotTask: async (key) => (key === "main" ? { id: TASK, scope: "intro", trailer: { task: TASK, action: "draft", scope: "intro", phase: "outline" } } : null),
    jobRun: (key) => (key === `job:${RUN}` ? { id: RUN, job: "digest", scope: "_app", trailer: { task: RUN, job: "digest" } } : null),
    emitToTask: (task, event) => void seen.events.push({ task, event }),
    serverEntry: "/app/out/main/tools-server.js",
    log: (m) => void seen.logs.push(m),
    ...o.over,
  };
  return { t: createToolsHost(deps), seen };
}

async function traceLines(id: string, sub = ""): Promise<Record<string, unknown>[]> {
  const text = await fs.readFile(path.join(base, ".harness", "trace", sub, `${id}.jsonl`), "utf8");
  return text
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe("createToolsHost (tools spec §4, §5)", () => {
  it("an agent request from a task slot calls the registry as agent with the task id, scope and phase", async () => {
    await built();
    const { t, seen } = wire();
    const ws = (await t.workspaceOptions())!;
    expect(await ws.request({ tool: "count", args: { n: 2 } }, { key: "main" })).toEqual([1, 2]);
    expect(seen.calls).toEqual([expect.objectContaining({ tool: "count", args: { n: 2 }, scope: "intro" })]);
    const [entry] = await traceLines(TASK);
    expect(entry).toMatchObject({ tool: "count", caller: "agent", task: TASK, phase: "outline", ok: true, resultSummary: "2 items" });
    expect(entry).not.toHaveProperty("job");
    // The chat's folded line, for that task.
    expect(seen.events).toEqual([
      { task: TASK, event: { type: "tool-call", call: expect.objectContaining({ tool: "count", caller: "agent", ok: true, summary: "2 items", args: '{"n":2}', result: "[1,2]" }) } },
    ]);
    // The trace answers the same view.
    expect(await t.trace(TASK)).toEqual([seen.events[0]!.event.type === "tool-call" ? (seen.events[0]!.event as { call: unknown }).call : null]);
  });

  it("an agent request from a job slot calls it as agent with job and run, whatever the job is", async () => {
    await built();
    const { t, seen } = wire();
    const ws = (await t.workspaceOptions())!;
    expect(await ws.request({ tool: "count" }, { key: `job:${RUN}` })).toEqual([1, 2]);
    expect(seen.calls[0]!.scope).toBe("_app");
    const [entry] = await traceLines(RUN, "jobs");
    expect(entry).toMatchObject({ tool: "count", caller: "agent", job: "digest", run: RUN, ok: true });
    expect(entry).not.toHaveProperty("task");
    // No task: no chat line.
    expect(seen.events).toEqual([]);
  });

  it("a slot with no running task or run is refused before the registry", async () => {
    await built();
    const { t, seen } = wire();
    const ws = (await t.workspaceOptions())!;
    await expect(ws.request({ tool: "count" }, { key: "lane-x" })).rejects.toThrow("No task is running in this session");
    await expect(ws.request({ tool: "count" }, { key: "job:other" })).rejects.toThrow("No task is running in this session");
    await expect(ws.request("count", { key: "main" })).rejects.toThrow("Invalid request");
    await expect(ws.request({ tool: 42 }, { key: "main" })).rejects.toThrow("Invalid request");
    expect(seen.calls).toEqual([]);
  });

  it("the agent can't call an agent: none tool (T7)", async () => {
    await built();
    const { t, seen } = wire();
    const ws = (await t.workspaceOptions())!;
    await expect(ws.request({ tool: "hidden" }, { key: "main" })).rejects.toThrow('Unknown tool "hidden"');
    expect(seen.calls).toEqual([]);
    // The UI may.
    expect(await t.uiCall("hidden", {})).toEqual({ ok: true, result: [1, 2] });
  });

  it("the catalogue file lists only agent: call tools, written once per workspace in <userData>/tools-catalogue/", async () => {
    await built();
    const { t } = wire();
    const ws = (await t.workspaceOptions())!;
    expect(ws.catalogue).toBe(path.join(userData, "tools-catalogue", "notes.json"));
    expect(ws.entry).toBe("/app/out/main/tools-server.js");
    const list = JSON.parse(await fs.readFile(ws.catalogue, "utf8")) as { name: string; description: string; inputSchema: unknown }[];
    expect(list.map((e) => e.name).sort()).toEqual(["count", "leak", "write"]);
    expect(list.find((e) => e.name === "count")).toEqual({ name: "count", description: TOOLS.count!.description, inputSchema: TOOLS.count!.params });
    expect((await fs.stat(ws.catalogue)).mode & 0o777).toBe(0o600);
    const first = (await fs.stat(ws.catalogue)).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    // Another workspace (a new runtime) takes the same file, not written again.
    expect((await t.workspaceOptions())!.catalogue).toBe(ws.catalogue);
    expect((await fs.stat(ws.catalogue)).mtimeMs).toBe(first);
    expect((await fs.readdir(path.join(userData, "tools-catalogue"))).sort()).toEqual(["notes.json"]);
  });

  it("no agent: call tool, or tools not built: no tools server and no catalogue", async () => {
    await built({ hidden: meta("hidden", { agent: "none" }) });
    const none = wire({ tools: { hidden: meta("hidden", { agent: "none" }) } });
    expect(await none.t.workspaceOptions()).toBeUndefined();
    await fs.rm(path.join(root, "dist", "tools.json"));
    const off = wire();
    expect(await off.t.workspaceOptions()).toBeUndefined();
    expect(off.t.info()).toEqual({ ids: ["count", "hidden", "leak", "write"], off: "Tools are not built: run humanharness build" });
    expect(await off.t.uiCall("count", {})).toEqual({ ok: false, error: "Tools are not built: run humanharness build" });
    await expect(fs.access(path.join(userData, "tools-catalogue"))).rejects.toThrow();
  });

  it("start prunes the trace and starts the host; stop stops it", async () => {
    await built();
    const old = path.join(base, ".harness", "trace", `${randomUUID()}.jsonl`);
    await fs.mkdir(path.dirname(old), { recursive: true });
    await fs.writeFile(old, `${JSON.stringify({ at: "2020-01-01T00:00:00.000Z", tool: "count" })}\n`);
    const long = new Date(Date.now() - 60 * 24 * 60 * 60_000);
    await fs.utimes(old, long, long);
    const { t, seen } = wire();
    await t.start();
    await t.start();
    expect(seen.started).toEqual([{ harnessId: "notes", dist: path.join(root, "dist"), ids: ["count", "hidden", "write", "leak"] }]);
    await expect(fs.access(old)).rejects.toThrow();
    expect(t.info()).toEqual({ ids: ["count", "hidden", "leak", "write"] });
    t.stop();
    expect(seen.stopped).toBe(1);
  });

  it("a base reached after start (a profile or folder switch) is pruned once, before its trace is used; one with no trace gets no folder", async () => {
    await built();
    const other = path.join(path.dirname(root), "other");
    const empty = path.join(path.dirname(root), "empty");
    await fs.mkdir(other);
    await fs.mkdir(empty);
    const stale = async (dir: string) => {
      const file = path.join(dir, ".harness", "trace", "ui", "2020-01-01.jsonl");
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `${JSON.stringify({ at: "2020-01-01T00:00:00.000Z", tool: "count" })}\n`);
      const long = new Date(Date.now() - 60 * 24 * 60 * 60_000);
      await fs.utimes(file, long, long);
      return file;
    };
    let current = base;
    const { t } = wire({ over: { base: async () => current } });
    await t.start();
    const old = await stale(other);
    current = other;
    expect(await t.trace(TASK)).toEqual([]);
    await expect(fs.access(old)).rejects.toThrow();
    // Once per base: a file made stale later in the same run waits for the next start.
    const again = await stale(other);
    expect(await t.uiCall("count", {})).toMatchObject({ ok: true });
    await expect(fs.access(again)).resolves.toBeUndefined();
    // Never creates anything: a base with no trace stays without .harness.
    current = empty;
    expect(await t.trace(TASK)).toEqual([]);
    await expect(fs.access(path.join(empty, ".harness"))).rejects.toThrow();
  });

  it("a harness id the host can't serve (over 63 characters) turns tools off with the reason", async () => {
    await built();
    const { t, seen } = wire({ startThrows: new Error("Not a harness id the tool host can serve") });
    await t.start();
    expect(t.info().off).toBe("Tools are off: Not a harness id the tool host can serve");
    expect(await t.uiCall("count", {})).toEqual({ ok: false, error: "Tools are off: Not a harness id the tool host can serve" });
    expect(seen.logs.some((l) => l.startsWith("Tools are off: Not a harness id the tool host can serve"))).toBe(true);
  });

  it("the host's files missing turns tools off with a logged reason, never a silent timeout", async () => {
    await built();
    const { t, seen } = wire({ startThrows: new Error("the tool host's files are missing") });
    await t.start();
    expect(seen.logs).toContain("Tools are off: the tool host's files are missing");
    expect(t.info().off).toBe("Tools are off: the tool host's files are missing");
    expect(await t.uiCall("count", {})).toEqual({ ok: false, error: "Tools are off: the tool host's files are missing" });
  });

  it("a UI call runs as ui in the open scope with no task; it traces under ui/<day>", async () => {
    await built();
    const { t, seen } = wire();
    expect(await t.uiCall("count", { n: 1 })).toEqual({ ok: true, result: [1, 2] });
    expect(seen.calls[0]!.scope).toBe("intro");
    const day = new Date().toISOString().slice(0, 10);
    const [entry] = await traceLines(day, "ui");
    expect(entry).toMatchObject({ tool: "count", caller: "ui" });
    expect(entry).not.toHaveProperty("task");
    expect(seen.events).toEqual([]);
  });

  it("a tool's data write during an agent call carries the calling task's (or job run's) trailer; a UI call's carries none", async () => {
    await built();
    const answer: Answer = async (c, channel) => {
      const r = await channel.ctx(c.tool, c.callId, "data.put", ["notes", { key: "a", text: "x" }]);
      return r.ok ? { ok: true, value: "done" } : { ok: false, error: r.refused };
    };
    const { t, seen } = wire({ answer });
    const ws = (await t.workspaceOptions())!;
    expect(await ws.request({ tool: "write" }, { key: "main" })).toBe("done");
    expect(await t.uiCall("write", {})).toEqual({ ok: true, result: "done" });
    expect(await ws.request({ tool: "write" }, { key: `job:${RUN}` })).toBe("done");
    expect(seen.data).toEqual([
      {
        request: { op: "put", collection: "notes", record: { key: "a", text: "x" } },
        call: { scope: "intro", tool: "write", trailer: { task: TASK, action: "draft", scope: "intro", phase: "outline" } },
      },
      { request: { op: "put", collection: "notes", record: { key: "a", text: "x" } }, call: { scope: "intro", tool: "write" } },
      { request: { op: "put", collection: "notes", record: { key: "a", text: "x" } }, call: { scope: "_app", tool: "write", trailer: { task: RUN, job: "digest" } } },
    ]);
  });

  it("a tool's ctx.log reaches main's log once, with its id and level, keys hidden, and no [tools] of its own (main's log adds it)", async () => {
    await built();
    const answer: Answer = async (c, channel) => {
      await channel.ctx(c.tool, c.callId, "log", ["info", `token is ${SECRET}`]);
      return { ok: true, value: 1 };
    };
    const { t, seen } = wire({ answer });
    await t.uiCall("leak", {});
    const lines = seen.logs.filter((l) => l.includes("token is"));
    expect(lines).toEqual(["leak: info: token is [redacted]"]);
  });

  it("a tool's ctx.log lines go into its trace entry and its chat line, keys hidden (spec §4.2)", async () => {
    await built();
    const answer: Answer = async (c, channel) => {
      await channel.ctx(c.tool, c.callId, "log", ["warn", `token is ${SECRET}`]);
      return { ok: true, value: 1 };
    };
    const { t, seen } = wire({ answer });
    const ws = (await t.workspaceOptions())!;
    await ws.request({ tool: "leak" }, { key: "main" });
    const [entry] = await traceLines(TASK);
    expect(entry!.logs).toEqual([{ level: "warn", message: "token is [redacted]" }]);
    const view = (seen.events[0]!.event as { call: { logs?: unknown } }).call;
    expect(view.logs).toEqual([{ level: "warn", message: "token is [redacted]" }]);
    expect(JSON.stringify(seen.events)).not.toContain(SECRET);
  });

  it("the chat line takes a trace entry's logs only when well formed: at most 20 lines of at most 300 characters", () => {
    const e = { at: "t", tool: "count", caller: "agent" as const, args: {}, resultSummary: "1", ms: 1, ok: true, accesses: [] };
    expect(toolCallView(e)).not.toHaveProperty("logs");
    const logs = [{ level: "loud", message: "x" }, { level: "info", message: 5 }, "nope", ...Array.from({ length: 25 }, (_, i) => ({ level: "info", message: `${i}${"y".repeat(400)}` }))];
    const view = toolCallView({ ...e, logs: logs as never });
    expect(view.logs).toHaveLength(20);
    expect(view.logs![0]!.message).toHaveLength(300);
    expect(view.logs![0]!.message.startsWith("0y")).toBe(true);
    expect(toolCallView({ ...e, logs: "x" as never })).not.toHaveProperty("logs");
  });

  describe("a job run's narrowed permissions (jobs J2): its tools never reach more than the job may", () => {
    const NET = { net: meta("net", { uses: { hosts: ["api.x.com"], exec: [{ cmd: "gh", args: ["*"] }] } }) };
    /** The net tool tries a fetch and a command and answers what the broker said to each. */
    const tries: Answer = async (c, channel) => {
      const fetched = await channel.ctx(c.tool, c.callId, "fetch", ["https://api.x.com/a"]);
      const ran = await channel.ctx(c.tool, c.callId, "exec", ["gh", ["pr"]]);
      return { ok: true, value: [fetched.ok ? "fetched" : fetched.refused, ran.ok ? "ran" : ran.refused] };
    };
    const jobHarness = (jobs: Record<string, unknown>): ToolsHarness => ({
      ...harness(NET),
      permissions: { edit: "folder", exec: true, web: true },
      jobs: jobs as ToolsHarness["jobs"],
    });

    it("web: false and exec: false: fetch and exec are refused naming them, and the trace shows access denied", async () => {
      await built(NET);
      const { t } = wire({ tools: NET, answer: tries, over: { harness: jobHarness({ digest: { permissions: { web: false, exec: false } } }) } });
      const ws = (await t.workspaceOptions())!;
      expect(await ws.request({ tool: "net" }, { key: `job:${RUN}` })).toEqual([
        'The job "digest" runs with web: false: its tools can\'t fetch',
        'The job "digest" runs with exec: false: its tools can\'t run commands',
      ]);
      const [entry] = await traceLines(RUN, "jobs");
      expect(entry!.accesses).toEqual([
        { kind: "fetch", target: "https://api.x.com/a", allowed: false },
        { kind: "exec", target: "gh pr", allowed: false },
      ]);
    });

    it("a job that narrows nothing, and a task's slot, are not limited by it", async () => {
      await built(NET);
      const { t } = wire({ tools: NET, answer: tries, over: { harness: jobHarness({ digest: { permissions: { edit: "none" } } }) } });
      const ws = (await t.workspaceOptions())!;
      for (const key of [`job:${RUN}`, "main"]) {
        const [fetched, ran] = (await ws.request({ tool: "net" }, { key })) as string[];
        expect(fetched).not.toContain("runs with");
        expect(ran).not.toContain("runs with");
      }
    });

    it("fails closed: a run whose job the harness doesn't declare gets fetch and exec refused", async () => {
      await built(NET);
      const { t } = wire({ tools: NET, answer: tries, over: { harness: jobHarness({}) } });
      const ws = (await t.workspaceOptions())!;
      expect(await ws.request({ tool: "net" }, { key: `job:${RUN}` })).toEqual([
        'The job "digest" runs with web: false: its tools can\'t fetch',
        'The job "digest" runs with exec: false: its tools can\'t run commands',
      ]);
    });
  });

  it("two agent calls at once (a task's and a job run's): each data write carries its own call's trailer, in any order", async () => {
    await built();
    const held: { c: ToolHostCall; channel: ToolChannel; done: (a: ToolHostAnswer) => void }[] = [];
    let both!: () => void;
    const ready = new Promise<void>((r) => (both = r));
    const answer: Answer = (c, channel) =>
      new Promise<ToolHostAnswer>((done) => {
        held.push({ c, channel, done });
        if (held.length === 2) both();
      });
    const { t, seen } = wire({ answer });
    const ws = (await t.workspaceOptions())!;
    const a = ws.request({ tool: "write" }, { key: "main" });
    const b = ws.request({ tool: "write" }, { key: `job:${RUN}` });
    await ready;
    // The second call's write first, then the first's: the trailer follows the call id, never the latest call.
    for (const h of [...held].reverse()) {
      const r = await h.channel.ctx(h.c.tool, h.c.callId, "data.put", ["notes", { key: h.c.scope }]);
      h.done(r.ok ? { ok: true, value: "done" } : { ok: false, error: r.refused });
    }
    expect(await Promise.all([a, b])).toEqual(["done", "done"]);
    // Released last-started first; each write is matched to its call by the scope that call ran in.
    expect(seen.data.map((x) => (x.request as { record: { key: string } }).record.key)).toEqual(held.map((h) => h.c.scope).reverse());
    expect([...seen.data].sort((x, y) => x.call.scope!.localeCompare(y.call.scope!)).map((x) => x.call)).toEqual([
      { scope: "_app", tool: "write", trailer: { task: RUN, job: "digest" } },
      { scope: "intro", tool: "write", trailer: { task: TASK, action: "draft", scope: "intro", phase: "outline" } },
    ]);
    // Each run's trailer is dropped when the call ends.
    expect(t.openRuns()).toBe(0);
  });

  it("a slot's task carries its trailer only when the trailer is that task's", async () => {
    const task = { id: TASK, scope: "intro" };
    const of = (trailer: { task: string } | undefined) => slotTaskOf({ runningTask: async () => task, trailerNow: async () => trailer });
    expect(await of({ task: TASK })).toEqual({ id: TASK, scope: "intro", trailer: { task: TASK } });
    // Read a moment apart, the open task may have changed between the two reads: no trailer then, never another task's.
    expect(await of({ task: "other-task" })).toEqual({ id: TASK, scope: "intro" });
    expect(await of(undefined)).toEqual({ id: TASK, scope: "intro" });
    expect(await slotTaskOf({ runningTask: async () => null, trailerNow: async () => ({ task: TASK }) })).toBeNull();
    expect(await slotTaskOf(undefined)).toBeNull();
  });

  it("a catalogue left by an earlier start is removed when tools are off or none is agent: call", async () => {
    await built();
    const first = wire();
    const file = (await first.t.workspaceOptions())!.catalogue;
    await built({ hidden: meta("hidden", { agent: "none" }) });
    const none = wire({ tools: { hidden: meta("hidden", { agent: "none" }) } });
    expect(await none.t.workspaceOptions()).toBeUndefined();
    await expect(fs.access(file)).rejects.toThrow();
    await built();
    expect((await wire().t.workspaceOptions())!.catalogue).toBe(file);
    await fs.rm(path.join(root, "dist", "tools.json"));
    expect(await wire().t.workspaceOptions()).toBeUndefined();
    await expect(fs.access(file)).rejects.toThrow();
  });

  it("the agent reads only the registry's answers: a tool's error with its keys hidden, else a fixed text", async () => {
    await built();
    const answer: Answer = async (c) => (c.tool === "leak" ? { ok: false, error: `bad token ${SECRET}` } : { ok: true, value: 1 });
    const { t } = wire({ answer, over: { slotTask: async () => Promise.reject(new Error("EACCES /Users/marco/secret/path")) } });
    const ws = (await t.workspaceOptions())!;
    // Something unexpected: never its message (a disk path, a stack).
    const err = await ws.request({ tool: "count" }, { key: "main" }).catch((e: Error) => e);
    expect((err as Error).message).toBe(TOOL_BROKE);
    // The tool's own error: verbatim, with the stored key hidden.
    const leak = wire({ answer });
    const ws2 = (await leak.t.workspaceOptions())!;
    const e2 = (await ws2.request({ tool: "leak" }, { key: "main" }).catch((e: Error) => e)) as Error;
    expect(e2.message).toMatch(/^bad token /);
    expect(e2.message).not.toContain(SECRET);
  });

  it("a command sees only PATH, HOME and LANG, and TERM=dumb (Decision 6)", () => {
    expect(toolExecEnv({ PATH: "/usr/bin", HOME: "/h", LANG: "en_US.UTF-8", AWS_SECRET: "x", NODE_OPTIONS: "--x" })).toEqual({
      TERM: "dumb",
      PATH: "/usr/bin",
      HOME: "/h",
      LANG: "en_US.UTF-8",
    });
  });

  it("main tells the window when the tools info changes: once started, and when the host goes off after crashes", async () => {
    await built();
    let onOff: ((reason: string) => void) | undefined;
    let off: string | null = null;
    const pushed: unknown[] = [];
    const { t } = wire({
      over: {
        host: { start: (p) => void (onOff = p.onOff), stop: () => {}, call: async () => ({ ok: true, value: 1 }), off: () => off },
        changed: () => void pushed.push(t.info()),
      },
    });
    await t.start();
    expect(pushed).toEqual([{ ids: ["count", "hidden", "leak", "write"] }]);
    off = TOOLS_OFF;
    onOff?.(TOOLS_OFF);
    expect(pushed.at(-1)).toEqual({ ids: ["count", "hidden", "leak", "write"], off: TOOLS_OFF });
    // The window's top line keys on this text (ui TOOLS_OFF_CRASHES): the two must stay the same.
    expect(TOOLS_OFF_CRASHES).toBe(TOOLS_OFF);
  });

  describe("off after repeated crashes: the Attention item (Decision 7)", () => {
    function inbox(fail = false) {
      const seen = { raised: [] as unknown[], resolved: [] as unknown[], creates: [] as boolean[] };
      const store = {
        raise: async (origin: unknown, input: unknown) => {
          if (fail) throw new Error("disk full");
          seen.raised.push({ origin, input });
          return { shown: true, notify: true };
        },
        resolve: async (origin: unknown, key: string) => void seen.resolved.push({ origin, key }),
      };
      return { seen, attention: async (create: boolean) => (seen.creates.push(create), store) };
    }
    function crashing(over: Partial<ToolsHostDeps>) {
      let onOff: ((reason: string) => void) | undefined;
      let off: string | null = null;
      const w = wire({ over: { host: { start: (p) => void (onOff = p.onOff), stop: () => {}, call: async () => ({ ok: true, value: 1 }), off: () => off }, ...over } });
      return { ...w, goOff: () => ((off = TOOLS_OFF), onOff?.(TOOLS_OFF)) };
    }
    const settle = () => new Promise((r) => setTimeout(r, 10));

    it("with an Attention store: one action item, raised once; the chat's top line still shows", async () => {
      await built();
      const { seen, attention } = inbox();
      const { t, goOff } = crashing({ attention });
      await t.start();
      goOff();
      goOff();
      await settle();
      expect(seen.raised).toEqual([
        { origin: { kind: "tool", id: "notes" }, input: { key: "off", severity: "action", title: "Tools are off after repeated crashes. Restart the app to turn them on." } },
      ]);
      expect(TOOLS_OFF_ITEM.title).toBe("Tools are off after repeated crashes. Restart the app to turn them on.");
      expect(t.info().off).toBe(TOOLS_OFF);
    });

    it("a start with tools on resolves the item an earlier run left, without making the inbox's key", async () => {
      await built();
      const { seen, attention } = inbox();
      const { t } = crashing({ attention });
      await t.start();
      await settle();
      expect(seen.resolved).toEqual([{ origin: { kind: "tool", id: "notes" }, key: "off" }]);
      expect(seen.creates).toEqual([false]);
      expect(seen.raised).toEqual([]);
    });

    it("without an Attention store nothing is raised (D0), and a raise that fails is logged, never thrown", async () => {
      await built();
      const none = crashing({ attention: async () => null });
      await none.t.start();
      expect(() => none.goOff()).not.toThrow();
      const { attention } = inbox(true);
      const failing = crashing({ attention });
      await failing.t.start();
      failing.goOff();
      await settle();
      expect(failing.seen.logs).toContain("Could not raise the tools' Attention item");
      expect(failing.t.info().off).toBe(TOOLS_OFF);
    });
  });
});

