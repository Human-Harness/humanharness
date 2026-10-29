import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type ToolMeta, z } from "@humanharness/harness-sdk";
import type { ToolCallView } from "@humanharness/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ToolDataCall } from "../../src/main/data-requests";
import type { ToolChannel, ToolHostAnswer, ToolHostCall } from "../../src/main/tools/tool-host";
import { type ToolsHarness, type ToolsHostDeps, createToolsHost, lastCallOf } from "../../src/main/tools/tools-host";

const RUN = "run-1";
let root: string;
let base: string;

beforeEach(async () => {
  const tmp = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tools-run-")));
  root = path.join(tmp, "harness");
  base = path.join(tmp, "base");
  await fs.mkdir(path.join(root, "dist"), { recursive: true });
  await fs.mkdir(base);
  const write: ToolMeta = { description: "Writes a note to the notes collection", agent: "none", uses: { data: { write: ["notes"] } }, params: { type: "object" }, timeout: 30, file: "tools/write.js" };
  await fs.writeFile(path.join(root, "dist", "tools.json"), JSON.stringify({ version: 1, tools: { write } }));
});
const pumps: ReturnType<typeof setInterval>[] = [];
afterEach(async () => {
  for (const p of pumps.splice(0)) clearInterval(p);
  await fs.rm(path.dirname(root), { recursive: true, force: true });
});

/** A host whose one tool, `write`, puts a note through ctx (the host page's channel, out of the registry's chain). */
function wire(jobs: ToolsHarness["jobs"] = { sync: {} }) {
  const data: { request: unknown; call: ToolDataCall }[] = [];
  let channel: ToolChannel | null = null;
  const page: (() => void)[] = [];
  const pump = setInterval(() => page.splice(0).forEach((run) => run()), 1);
  pumps.push(pump);
  const answer = async (c: ToolHostCall): Promise<ToolHostAnswer> => {
    const r = await channel!.ctx(c.tool, c.callId, "data.put", ["notes", { key: "a", text: "x" }]);
    return r.ok ? { ok: true, value: "done" } : { ok: false, error: r.refused };
  };
  const deps: ToolsHostDeps = {
    harness: {
      id: "notes",
      root,
      permissions: { edit: "folder", exec: false, web: false },
      data: { notes: { label: "Notes", agent: "read" } } as never,
      tools: { write: "./tools/write.ts" },
      jobs,
    },
    base: async () => base,
    references: async () => [],
    userData: path.join(path.dirname(root), "user-data"),
    store: { harnessValues: async () => ({}) },
    data: async (request, call) => (data.push({ request, call }), { ok: true }),
    exec: { resolve: async () => null, run: (() => Promise.reject(new Error("no"))) as never, env: async () => ({}) },
    fetch: (() => Promise.reject(new Error("no network"))) as never,
    allowHost: async () => false,
    host: {
      start: (p) => {
        channel = p.channel;
      },
      stop: () => undefined,
      call: (c) => new Promise<ToolHostAnswer>((resolve) => page.push(() => void answer(c).then(resolve))),
      off: () => null,
    },
    openScope: async () => "intro",
    slotTask: async () => null,
    jobRun: () => null,
    emitToTask: () => undefined,
    log: () => undefined,
  };
  return { t: createToolsHost(deps), data };
}

describe("toolsHost.withRunTrailer (tools spec §7.1: a recipe's tool steps)", () => {
  it("a tool's data write from a job run's call carries the run's trailer; outside it, none", async () => {
    const { t, data } = wire();
    const call = { tool: "write", args: {}, caller: "job" as const, scope: "intro", job: "sync", run: RUN, limits: { job: "sync", web: false, exec: false } };
    const a = await t.withRunTrailer({ task: RUN, job: "sync", scope: "intro" }, () => t.registry.call(call));
    expect(a).toMatchObject({ ok: true, result: "done" });
    expect(data[0]!.call).toStrictEqual({ scope: "intro", tool: "write", trailer: { task: RUN, job: "sync", scope: "intro" } });
    await t.registry.call(call);
    expect(Object.hasOwn(data[1]!.call, "trailer")).toBe(false);
    expect(t.openRuns()).toBe(0);
  });

  it("answers what fn answers and passes its throw on", async () => {
    const { t } = wire();
    expect(await t.withRunTrailer({ task: RUN, job: "sync" }, async () => 7)).toBe(7);
    await expect(t.withRunTrailer({ task: RUN, job: "sync" }, async () => Promise.reject(new Error("x")))).rejects.toThrow("x");
  });
});

describe("the tools host's harness: a job's steps (tools spec §3.3)", () => {
  it("a recipe's steps reach the tools.json checks: a source that can't be checked turns tools off", async () => {
    // `write` declares no returns, so the AI step can't read its result: typed in ToolsHarness, so never dropped on the way.
    const { t } = wire({ sync: { steps: [{ tool: "write", as: "w" }, { ai: "./jobs/a.md", input: ["w"], output: z.object({ ok: z.boolean() }), tier: "standard" }] } });
    await t.start();
    expect(t.info().off).toMatch(/^Job "sync": steps\[1\]: input "w"/);
  });
});

describe("lastCallOf (a recipe run's line: its last call, tools spec §7.4)", () => {
  const view = (tool: string, summary: string, note?: string): ToolCallView => ({
    tool,
    caller: "job",
    ok: true,
    ms: 1,
    summary,
    args: "{}",
    accesses: [],
    at: "2026-10-29T10:00:00.000Z",
    ...(note ? { note } : {}),
  });

  it("skips a trace note after the last call: an AI round's note never becomes the run's line", () => {
    const trace = [view("fetch-ci", "3 runs"), view("notify", "a string"), view("step_output", "", "AI step: round 1")];
    expect(lastCallOf(trace)).toStrictEqual({ tool: "notify", resultSummary: "a string" });
  });

  it("only notes, or nothing: null", () => {
    expect(lastCallOf([view("notify", "", "notify was not called")])).toBeNull();
    expect(lastCallOf([])).toBeNull();
  });
});
