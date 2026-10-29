import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolMeta } from "@humanharness/harness-sdk";
import type { Event } from "@humanharness/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolDataCall } from "../../src/main/data-requests";
import type { ToolChannel, ToolHostAnswer, ToolHostCall } from "../../src/main/tools/tool-host";
import { TOOL_BROKE, type ToolsHarness, type ToolsHostDeps, createToolsHost, toolExecEnv } from "../../src/main/tools/tools-host";

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

  it("a harness id the host can't serve (over 63 characters) turns tools off with the reason", async () => {
    await built();
    const { t, seen } = wire({ startThrows: new Error("Not a harness id the tool host can serve") });
    await t.start();
    expect(t.info().off).toBe("Tools are off: Not a harness id the tool host can serve");
    expect(await t.uiCall("count", {})).toEqual({ ok: false, error: "Tools are off: Not a harness id the tool host can serve" });
    expect(seen.logs.some((l) => l.startsWith("Tools are off: the tools host could not start"))).toBe(true);
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
});
