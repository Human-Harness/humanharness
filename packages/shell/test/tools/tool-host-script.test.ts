import { describe, expect, it } from "vitest";
// @ts-expect-error a plain ES module served to the sandbox
import { runHost } from "../../resources/tool-host.mjs";

// biome-ignore lint/suspicious/noExplicitAny: a tool's ctx is untyped here, as in a built bundle
type Any = any;

/** main's end: `next` hands out `commands` in order (then never answers), `ctx` answers `ctx`, the rest null. */
function fakeRpc(commands: unknown[], ctx: (a: { callId: string; name: string; args: unknown[] }) => unknown = () => ({ ok: true, value: null })) {
  const calls: [string, Any][] = [];
  const rpc = async (method: string, args: unknown) => {
    calls.push([method, args]);
    if (method === "next") return commands.shift() ?? new Promise(() => {});
    if (method === "ctx") return ctx(args as { callId: string; name: string; args: unknown[] });
    return null;
  };
  const of = (method: string) => calls.filter(([m]) => m === method).map(([, a]) => a);
  return { rpc, calls, of };
}

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const call = (callId: string, tool: string, args: unknown = {}, scope: string | null = null) => ({ kind: "call", callId, tool, args, scope });
/** A built bundle's module: `export { def as default }`. */
const bundle = (def: Record<string, unknown>) => ({ default: def });

describe("the tool host script (tools spec §4.1)", () => {
  it("imports every dist tool, reports ready with the ids that loaded and each load error", async () => {
    const { rpc, calls } = fakeRpc([]);
    const imported: string[] = [];
    void runHost(rpc, ["pr-ci", "broken", "no-run", "count"], async (id: string) => {
      imported.push(id);
      if (id === "broken") throw new SyntaxError("Unexpected token");
      if (id === "no-run") return bundle({ description: "x" });
      return bundle({ run: async () => 1 });
    });
    await settle();
    expect(imported.sort()).toEqual(["broken", "count", "no-run", "pr-ci"]);
    expect(calls[0]).toEqual([
      "ready",
      {
        tools: ["pr-ci", "count"],
        errors: [
          { tool: "broken", error: "SyntaxError: Unexpected token" },
          { tool: "no-run", error: "Error: its default export has no run function" },
        ],
      },
    ]);
    expect(calls[1]).toEqual(["next", undefined]);
  });

  it("summary() is cut at 16000 characters, not 200: main hides the keys first, then cuts (T4)", async () => {
    const tools: Record<string, unknown> = { long: bundle({ run: async () => 1, summary: () => "s".repeat(20_000) }) };
    const { rpc, of } = fakeRpc([call("c1", "long")]);
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    expect(of("done")).toEqual([{ callId: "c1", ok: true, value: 1, summary: "s".repeat(16_000) }]);
  });

  it("a call runs run(args, ctx) and answers done with the value and summary(result) when the tool has one", async () => {
    const seen: unknown[] = [];
    const tools: Record<string, unknown> = {
      count: bundle({
        run: async (args: Any, ctx: Any) => {
          seen.push(args, ctx.scope);
          return { items: [1, 2, 3] };
        },
        summary: (r: Any) => `${r.items.length} items`,
      }),
      plain: bundle({ run: async () => "text" }),
      nothing: bundle({ run: async () => undefined }),
      badSummary: bundle({
        run: async () => 1,
        summary: () => {
          throw new Error("no");
        },
      }),
    };
    const { rpc, of } = fakeRpc([call("c1", "count", { folder: "a" }, "intro"), call("c2", "plain"), call("c3", "nothing"), call("c4", "badSummary")]);
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    expect(seen).toEqual([{ folder: "a" }, "intro"]);
    expect(of("done")).toEqual([
      { callId: "c1", ok: true, value: { items: [1, 2, 3] }, summary: "3 items" },
      { callId: "c2", ok: true, value: "text" },
      { callId: "c3", ok: true, value: null },
      { callId: "c4", ok: true, value: 1 },
    ]);
  });

  it("ctx calls carry the call id; files, data, fetch and exec go over rpc; log is fire-and-forget", async () => {
    const tool = bundle({
      run: async (_a: Any, ctx: Any) => {
        const text = await ctx.files.read("notes.md");
        const list = await ctx.files.list("notes", "*.md");
        await ctx.data.get("results", 3);
        await ctx.data.query("results", { limit: 1 });
        await ctx.data.put("results", { a: 1 });
        await ctx.data.patch("results", undefined, { a: 2 });
        await ctx.data.delete("results");
        const r = await ctx.fetch("https://api.x.com/a", { headers: { authorization: "Bearer {{secret:jira}}" } });
        const ran = await ctx.exec("gh", ["pr", "list"]);
        const logged = ctx.log("info", "hi");
        return { text, list, json: r.json(), status: r.status, ran, logged: logged === undefined };
      },
    });
    const { rpc, of } = fakeRpc([call("c9", "t")], ({ name }) => {
      if (name === "files.read") return { ok: true, value: "# notes" };
      if (name === "files.list") return { ok: true, value: ["notes/a.md"] };
      if (name === "fetch") return { ok: true, value: { url: "u", status: 200, ok: true, headers: {}, text: '{"a":1}' } };
      if (name === "exec") return { ok: true, value: { code: 0, stdout: "x", stderr: "" } };
      return { ok: true, value: null };
    });
    void runHost(rpc, ["t"], async () => tool);
    await settle();
    expect(of("ctx")).toEqual([
      { callId: "c9", name: "files.read", args: ["notes.md"] },
      { callId: "c9", name: "files.list", args: ["notes", "*.md"] },
      { callId: "c9", name: "data.get", args: ["results", 3] },
      { callId: "c9", name: "data.query", args: ["results", { limit: 1 }] },
      { callId: "c9", name: "data.put", args: ["results", { a: 1 }] },
      { callId: "c9", name: "data.patch", args: ["results", undefined, { a: 2 }] },
      { callId: "c9", name: "data.delete", args: ["results"] },
      { callId: "c9", name: "fetch", args: ["https://api.x.com/a", { headers: { authorization: "Bearer {{secret:jira}}" } }] },
      { callId: "c9", name: "exec", args: ["gh", ["pr", "list"]] },
      { callId: "c9", name: "log", args: ["info", "hi"] },
    ]);
    expect(of("done")).toEqual([
      { callId: "c9", ok: true, value: { text: "# notes", list: ["notes/a.md"], json: { a: 1 }, status: 200, ran: { code: 0, stdout: "x", stderr: "" }, logged: true } },
    ]);
  });

  it("calls run concurrently: a slow call doesn't hold the next", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const tools: Record<string, unknown> = {
      slow: bundle({
        run: async () => {
          await gate;
          return "slow";
        },
      }),
      fast: bundle({ run: async () => "fast" }),
    };
    const { rpc, of } = fakeRpc([call("c1", "slow"), call("c2", "fast")]);
    void runHost(rpc, ["slow", "fast"], async (id: string) => tools[id]);
    await settle();
    expect(of("done")).toEqual([{ callId: "c2", ok: true, value: "fast" }]);
    release();
    await settle();
    expect(of("done")).toEqual([
      { callId: "c2", ok: true, value: "fast" },
      { callId: "c1", ok: true, value: "slow" },
    ]);
  });

  it("a refused ctx call throws an Error named ToolRefused", async () => {
    const seen: string[] = [];
    const tool = bundle({
      run: async (_a: Any, ctx: Any) => {
        try {
          await ctx.files.read("notes.md");
        } catch (e: Any) {
          seen.push(`${e instanceof Error} ${e.name}: ${e.message}`);
        }
        try {
          await ctx.fetch("https://x/");
        } catch (e: Any) {
          seen.push(`${e.name}: ${e.message}`);
        }
        return null;
      },
    });
    const { rpc } = fakeRpc([call("c1", "t")], ({ name }) => (name === "files.read" ? { ok: false, refused: "This tool doesn't declare uses.files" } : { ok: false, refused: "Too many calls at once" }));
    void runHost(rpc, ["t"], async () => tool);
    await settle();
    expect(seen).toEqual(["true ToolRefused: This tool doesn't declare uses.files", "ToolRefused: Too many calls at once"]);
  });

  it("a thrown error answers done { ok: false, error } cut to 16,000 characters; an unknown or inherited tool is an error too", async () => {
    const tools: Record<string, unknown> = {
      boom: bundle({
        run: async () => {
          throw new Error("HTTP 500");
        },
      }),
      long: bundle({
        run: async () => {
          throw new Error("x".repeat(20_000));
        },
      }),
      odd: bundle({
        run: async () => {
          throw "a string";
        },
      }),
    };
    const { rpc, of } = fakeRpc([call("c1", "boom"), call("c2", "long"), call("c3", "odd"), call("c4", "nope"), call("c5", "toString"), { kind: "idle" }]);
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    const done = of("done");
    expect(done[0]).toEqual({ callId: "c1", ok: false, error: "HTTP 500" });
    expect(done[1].error).toHaveLength(16_000);
    expect(done[2]).toEqual({ callId: "c3", ok: false, error: "a string" });
    expect(done[3]).toEqual({ callId: "c4", ok: false, error: 'No tool "nope"' });
    expect(done[4]).toEqual({ callId: "c5", ok: false, error: 'No tool "toString"' });
  });

  it("a result the channel can't carry answers an error instead", async () => {
    const calls: [string, Any][] = [];
    let nexts = 0;
    const rpc = async (method: string, args: Any) => {
      calls.push([method, args]);
      if (method === "next") return nexts++ === 0 ? call("c1", "t") : new Promise(() => {});
      // As the preload's JSON.stringify would throw on a BigInt:
      if (method === "done" && args.ok && typeof args.value === "bigint") throw new TypeError("Do not know how to serialize a BigInt");
      return null;
    };
    void runHost(rpc, ["t"], async () => bundle({ run: async () => 10n }));
    await settle();
    const done = calls.filter(([m]) => m === "done").map(([, a]) => a);
    expect(done.at(-1)).toEqual({ callId: "c1", ok: false, error: "The result can't be sent: TypeError: Do not know how to serialize a BigInt" });
  });

  it("stops pulling when main refuses next or ready (the window is gone or not ready)", async () => {
    const calls: string[] = [];
    const rpc = async (method: string) => {
      calls.push(method);
      return { ok: false, refused: "Unexpected sender" };
    };
    await runHost(rpc, [], async () => ({}));
    expect(calls).toEqual(["ready"]);
    const calls2: string[] = [];
    const rpc2 = async (method: string) => {
      calls2.push(method);
      if (method === "next") return { ok: false, refused: "Tools stopped" };
      return null;
    };
    await runHost(rpc2, [], async () => ({}));
    expect(calls2).toEqual(["ready", "next"]);
  });
});
