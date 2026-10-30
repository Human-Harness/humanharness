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
const call = (callId: string, tool: string) => ({ kind: "call", callId, tool, args: {}, scope: null });
const bundle = (def: Record<string, unknown>) => ({ default: def });

describe("the tool host script: ctx.summary and ctx.requestAi (tools spec §4.2, §7.3)", () => {
  it("ctx.summary(text) sends the broker call summary with the text and resolves", async () => {
    const got: unknown[] = [];
    const tools: Record<string, unknown> = {
      sync: bundle({
        run: async (_a: unknown, ctx: Any) => {
          got.push(await ctx.summary("Synced 3 tickets"));
          return 1;
        },
      }),
    };
    const { rpc, of } = fakeRpc([call("c1", "sync")]);
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    expect(of("ctx")).toEqual([{ callId: "c1", name: "summary", args: ["Synced 3 tickets"] }]);
    expect(got).toEqual([undefined]);
    expect(of("done")).toEqual([{ callId: "c1", ok: true, value: 1 }]);
  });

  it("ctx.requestAi(input) sends the broker call requestAi with the input and resolves; a refusal rejects with ToolRefused", async () => {
    const got: unknown[] = [];
    const tools: Record<string, unknown> = {
      post: bundle({
        run: async (_a: unknown, ctx: Any) => {
          got.push(await ctx.requestAi({ ids: ["a"] }));
          try {
            await ctx.requestAi({ ids: ["b"] });
          } catch (e) {
            got.push([(e as Error).name, (e as Error).message]);
          }
          return 2;
        },
      }),
    };
    let n = 0;
    const { rpc, of } = fakeRpc([call("c1", "post")], () => (++n === 1 ? { ok: true, value: null } : { ok: false, refused: "ctx.requestAi was already called in this call" }));
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    expect(of("ctx")).toEqual([
      { callId: "c1", name: "requestAi", args: [{ ids: ["a"] }] },
      { callId: "c1", name: "requestAi", args: [{ ids: ["b"] }] },
    ]);
    expect(got).toEqual([undefined, ["ToolRefused", "ctx.requestAi was already called in this call"]]);
    expect(of("done")).toEqual([{ callId: "c1", ok: true, value: 2 }]);
  });

  it("ctx.requestAi refuses a function, a symbol or a bigint, at the top or inside, without calling main", async () => {
    const got: unknown[] = [];
    const inputs: unknown[] = [() => 1, Symbol("s"), 10n, { ids: ["a"], f: () => 1 }, [Symbol("s")], { n: { big: 1n } }];
    const tools: Record<string, unknown> = {
      post: bundle({
        run: async (_a: unknown, ctx: Any) => {
          for (const input of inputs) {
            try {
              await ctx.requestAi(input);
              got.push("sent");
            } catch (e) {
              got.push([(e as Error).name, (e as Error).message]);
            }
          }
          return 3;
        },
      }),
    };
    const { rpc, of } = fakeRpc([call("c1", "post")]);
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    expect(of("ctx")).toEqual([]);
    expect(got).toEqual(inputs.map(() => ["ToolRefused", "ctx.requestAi takes JSON data"]));
    expect(of("done")).toEqual([{ callId: "c1", ok: true, value: 3 }]);
  });

  it("the ctx keeps its other members: summary and requestAi are the only new ones", async () => {
    let keys: string[] = [];
    const tools: Record<string, unknown> = {
      look: bundle({
        run: async (_a: unknown, ctx: Any) => {
          keys = Object.keys(ctx).sort();
          return Object.isFrozen(ctx);
        },
      }),
    };
    const { rpc, of } = fakeRpc([call("c1", "look")]);
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    expect(keys).toEqual(["data", "exec", "fetch", "files", "inputs", "log", "requestAi", "scope", "summary"]);
    expect(of("done")).toEqual([{ callId: "c1", ok: true, value: true }]);
  });
});
