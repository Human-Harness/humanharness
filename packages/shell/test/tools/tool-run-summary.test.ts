import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolMeta } from "@humanharness/harness-sdk";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ToolBroker, type ToolBrokerDeps } from "../../src/main/tools/tool-broker";
import { type ToolCall, ToolRegistry } from "../../src/main/tools/tool-registry";
import type { TraceEntry } from "../../src/main/tools/tool-trace";

const SECRET = "tok-SECRET-1234";
const RUN = "0b9f3c1e-5a2d-4c6b-9e8f-1a2b3c4d5e6f";
const POST_ONLY = "ctx.requestAi is only for the step right after a job's AI step";
let userData: string;

beforeEach(async () => {
  userData = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tool-run-summary-")));
});
afterEach(async () => {
  await fs.rm(userData, { recursive: true, force: true });
});

const meta: ToolMeta = { description: "Syncs the tickets", agent: "call", uses: {}, params: { type: "object" }, timeout: 30, file: "tools/sync.js" };

type Ctx = (name: string, ...args: unknown[]) => Promise<{ ok: boolean; refused?: string; value?: unknown }>;

/**
 * A registry with a real ToolBroker; the host double runs `tool(ctx)`, whose ctx calls go to the broker under the
 * call's id as the host script's do, then answers what `tool` returns (or its throw as the tool's error).
 */
function rig(tool: (ctx: Ctx) => Promise<unknown>) {
  const entries: TraceEntry[] = [];
  const answers: { name: string; ok: boolean; refused?: string }[] = [];
  const deps: ToolBrokerDeps = {
    harnessId: "dev",
    tool: "sync",
    meta,
    secrets: [{ id: "jira", label: "Jira token" }],
    store: { harnessValues: async () => ({ jira: SECRET }) },
    data: async () => null,
    files: async () => ({ read: async () => "", list: async () => [] }),
    fetch: (async () => new Response("ok")) as unknown as typeof fetch,
    allowHost: async () => true,
    userData,
    exec: { resolve: async (cmd) => `/usr/bin/${cmd}`, run: async () => ({ code: 0, stdout: "", stderr: "" }), env: async () => ({}) },
    log: async () => undefined,
  };
  const broker = new ToolBroker(deps);
  const registry = new ToolRegistry({
    json: async () => ({ on: true, tools: { sync: meta } }),
    host: {
      call: async (c) => {
        const ctx: Ctx = async (name, ...args) => {
          const a = await broker.call(c.callId, name, args);
          answers.push({ name, ok: a.ok, ...(a.ok ? {} : { refused: a.refused }) });
          return a as { ok: boolean; refused?: string; value?: unknown };
        };
        try {
          return { callId: c.callId, ok: true, value: await tool(ctx) };
        } catch (e) {
          return { callId: c.callId, ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      off: () => null,
    },
    broker: () => broker,
    trace: { append: async (e) => void entries.push(e) },
    secretValues: async () => [SECRET],
  });
  return { registry, entries, answers };
}

const job = (over: Partial<ToolCall> = {}): ToolCall => ({ tool: "sync", args: {}, caller: "job", scope: null, job: "sync", run: RUN, ...over });

describe("ctx.summary and ctx.requestAi (tools spec §4.2, §7.3, §7.4)", () => {
  it("D0: a call without summary or requestAi answers as before", async () => {
    const { registry } = rig(async () => ({ n: 3 }));
    expect(await registry.call({ tool: "sync", args: {}, caller: "ui", scope: null })).toStrictEqual({ ok: true, result: { n: 3 } });
    expect(await registry.call(job())).toStrictEqual({ ok: true, result: { n: 3 } });
    expect(await registry.call(job({ post: true }))).toStrictEqual({ ok: true, result: { n: 3 } });
  });

  it("summary: the answer carries the last summary, on one line, cut at 300 characters", async () => {
    const { registry, answers } = rig(async (ctx) => {
      await ctx("summary", "a\nb");
      await ctx("summary", "x".repeat(400));
      return 1;
    });
    const a = await registry.call(job());
    expect(answers.every((x) => x.ok)).toBe(true);
    expect(a).toStrictEqual({ ok: true, result: 1, summary: "x".repeat(300) });
  });

  it("summary: controls become spaces, hidden characters go, and a stored key is hidden before the cut", async () => {
    const { registry } = rig(async (ctx) => {
      await ctx("summary", `  Synced\u2028 3\u200b tickets\t· ${"y".repeat(280)}${SECRET}  `);
      return 1;
    });
    const a = (await registry.call(job())) as { summary?: string };
    expect(a.summary).toBe(`Synced 3 tickets · ${"y".repeat(280)}[`);
    expect(a.summary).not.toContain("tok-");
    expect([...a.summary!].length).toBe(300);
  });

  it("summary is accepted from every caller (ui, agent, pre, job); only a job run's answer keeps it", async () => {
    const { registry, answers } = rig(async (ctx) => {
      await ctx("summary", "Synced 3 tickets");
      return 1;
    });
    for (const caller of ["ui", "agent", "pre"] as const) {
      expect(await registry.call({ tool: "sync", args: {}, caller, scope: null, task: RUN })).toStrictEqual({ ok: true, result: 1 });
    }
    expect(await registry.call(job())).toStrictEqual({ ok: true, result: 1, summary: "Synced 3 tickets" });
    expect(answers).toEqual(Array.from({ length: 4 }, () => ({ name: "summary", ok: true })));
  });

  it("a summary that isn't a string is refused", async () => {
    const { registry, answers } = rig(async (ctx) => {
      await ctx("summary", 3);
      return 1;
    });
    expect(await registry.call(job())).toStrictEqual({ ok: true, result: 1 });
    expect(answers).toEqual([{ name: "summary", ok: false, refused: "ctx.summary takes a string" }]);
  });

  it("requestAi: refused unless the call is a job's post-step", async () => {
    const { registry, answers } = rig(async (ctx) => {
      await ctx("requestAi", { ids: ["a"] });
      return 1;
    });
    const calls: ToolCall[] = [job(), { tool: "sync", args: {}, caller: "pre", scope: null, task: RUN, post: true }, { tool: "sync", args: {}, caller: "agent", scope: null, job: "sync", run: RUN, post: true }];
    for (const c of calls) expect(await registry.call(c)).toStrictEqual({ ok: true, result: 1 });
    expect(answers).toEqual(Array.from({ length: 3 }, () => ({ name: "requestAi", ok: false, refused: POST_ONLY })));
  });

  it("requestAi: a post call's answer carries the input", async () => {
    const { registry, answers } = rig(async (ctx) => {
      await ctx("requestAi", { ids: ["a"] });
      return 1;
    });
    expect(await registry.call(job({ post: true }))).toStrictEqual({ ok: true, result: 1, requestAi: { input: { ids: ["a"] } } });
    expect(answers).toEqual([{ name: "requestAi", ok: true }]);
  });

  it("requestAi: a stored key in the input is hidden", async () => {
    const { registry } = rig(async (ctx) => {
      await ctx("requestAi", { note: `key ${SECRET}` });
      return 1;
    });
    const a = await registry.call(job({ post: true }));
    expect(JSON.stringify(a)).not.toContain(SECRET);
    expect(a.ok && a.requestAi).toEqual({ input: { note: "key [redacted]" } });
  });

  it("requestAi: a second call in the same call is refused", async () => {
    const { registry, answers } = rig(async (ctx) => {
      await ctx("requestAi", { round: 1 });
      await ctx("requestAi", { round: 2 });
      return 1;
    });
    const a = await registry.call(job({ post: true }));
    expect(answers).toEqual([
      { name: "requestAi", ok: true },
      { name: "requestAi", ok: false, refused: "ctx.requestAi was already called in this call" },
    ]);
    expect(a.ok && a.requestAi).toEqual({ input: { round: 1 } });
  });

  it("requestAi: each call of the tool has its own once", async () => {
    let round = 0;
    const { registry } = rig(async (ctx) => {
      await ctx("requestAi", { round: ++round });
      return 1;
    });
    expect((await registry.call(job({ post: true }))).ok && true).toBe(true);
    const second = await registry.call(job({ post: true }));
    expect(second.ok && second.requestAi).toEqual({ input: { round: 2 } });
  });

  it("requestAi: input over 1 MB of JSON is refused", async () => {
    const { registry, answers } = rig(async (ctx) => {
      await ctx("requestAi", { text: "é".repeat(600_000) });
      return 1;
    });
    expect(await registry.call(job({ post: true }))).toStrictEqual({ ok: true, result: 1 });
    expect(answers).toEqual([{ name: "requestAi", ok: false, refused: "The request is too large" }]);
  });

  it("requestAi: input that isn't JSON (undefined, a big number) is refused", async () => {
    const { registry, answers } = rig(async (ctx) => {
      // What crosses the host page's rpc is JSON already; main still refuses what JSON can't hold.
      await ctx("requestAi", undefined);
      await ctx("requestAi", 10n);
      return 1;
    });
    expect(await registry.call(job({ post: true }))).toStrictEqual({ ok: true, result: 1 });
    expect(answers.map((x) => x.refused)).toEqual(["ctx.requestAi takes JSON data", "ctx.requestAi takes JSON data"]);
  });

  it("requestAi: a cycle is refused", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const { registry, answers } = rig(async (ctx) => {
      await ctx("requestAi", cyclic);
      return 1;
    });
    expect(await registry.call(job({ post: true }))).toStrictEqual({ ok: true, result: 1 });
    expect(answers[0]?.ok).toBe(false);
    expect(answers[0]?.refused).toMatch(/^(ctx\.requestAi takes JSON data|The call is too large \(requestAi\))$/);
  });

  it("a failed call still carries its summary, never a requestAi", async () => {
    const { registry } = rig(async (ctx) => {
      await ctx("summary", "Half done");
      await ctx("requestAi", { ids: ["a"] });
      throw new Error("Jira answered 500");
    });
    expect(await registry.call(job({ post: true }))).toStrictEqual({ ok: false, error: "Jira answered 500", summary: "Half done" });
  });

  it("neither summary nor requestAi reaches the trace entry", async () => {
    const plain = rig(async () => 1);
    await plain.registry.call(job({ post: true }));
    const { registry, entries } = rig(async (ctx) => {
      await ctx("summary", "Synced");
      await ctx("requestAi", { ids: ["a"] });
      return 1;
    });
    await registry.call(job({ post: true }));
    const strip = (e: TraceEntry) => ({ ...e, at: "", ms: 0 });
    expect(entries.map(strip)).toStrictEqual(plain.entries.map(strip));
    expect(JSON.stringify(entries)).not.toMatch(/Synced|requestAi|"ids"/);
  });
});
