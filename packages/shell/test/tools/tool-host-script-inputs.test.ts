import { describe, expect, it } from "vitest";
// @ts-expect-error a plain ES module served to the sandbox
import { runHost } from "../../resources/tool-host.mjs";

// biome-ignore lint/suspicious/noExplicitAny: a tool's ctx is untyped here, as in a built bundle
type Any = any;

/** main's end: `next` hands out `commands` in order (then never answers), the rest null. */
function fakeRpc(commands: unknown[]) {
  const calls: [string, Any][] = [];
  const rpc = async (method: string, args: unknown) => {
    calls.push([method, args]);
    if (method === "next") return commands.shift() ?? new Promise(() => {});
    return null;
  };
  const of = (method: string) => calls.filter(([m]) => m === method).map(([, a]) => a);
  return { rpc, of };
}

const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const bundle = (def: Record<string, unknown>) => ({ default: def });

describe("ctx.inputs in the tool host script (tools spec §4.2; P3)", () => {
  it("ctx.inputs is the command's inputs", async () => {
    let seen: unknown;
    const tools: Record<string, unknown> = { due: bundle({ run: async (_a: Any, ctx: Any) => ((seen = ctx.inputs), 1) }) };
    const { rpc } = fakeRpc([{ kind: "call", callId: "c1", tool: "due", args: {}, scope: null, inputs: { today: [{ id: 1 }] } }]);
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    expect(seen).toEqual({ today: [{ id: 1 }] });
  });

  it("ctx.inputs is frozen all the way down: a write throws in strict mode", async () => {
    const errors: string[] = [];
    const tools: Record<string, unknown> = {
      due: bundle({
        run: async (_a: Any, ctx: Any) => {
          for (const write of [() => (ctx.inputs.other = 1), () => (ctx.inputs.today[0].id = 2), () => ctx.inputs.today.push(3)]) {
            try {
              write();
            } catch (e) {
              errors.push((e as Error).name);
            }
          }
          return ctx.inputs.today[0].id;
        },
      }),
    };
    const { rpc, of } = fakeRpc([{ kind: "call", callId: "c1", tool: "due", args: {}, scope: null, inputs: { today: [{ id: 1 }] } }]);
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    expect(errors).toEqual(["TypeError", "TypeError", "TypeError"]);
    expect(of("done")).toEqual([{ callId: "c1", ok: true, value: 1 }]);
  });

  it("a command without inputs gives ctx.inputs = {}, frozen", async () => {
    let seen: Any;
    const tools: Record<string, unknown> = { due: bundle({ run: async (_a: Any, ctx: Any) => ((seen = ctx.inputs), 1) }) };
    const { rpc } = fakeRpc([{ kind: "call", callId: "c1", tool: "due", args: {}, scope: null }]);
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    expect(seen).toEqual({});
    expect(Object.isFrozen(seen)).toBe(true);
  });

  it("inputs that aren't an object (null, an array, a string) give {}", async () => {
    const seen: unknown[] = [];
    const tools: Record<string, unknown> = { due: bundle({ run: async (_a: Any, ctx: Any) => (seen.push(ctx.inputs), 1) }) };
    const cmds = [null, [1], "x"].map((inputs, i) => ({ kind: "call", callId: `c${i}`, tool: "due", args: {}, scope: null, inputs }));
    const { rpc } = fakeRpc(cmds);
    void runHost(rpc, Object.keys(tools), async (id: string) => tools[id]);
    await settle();
    expect(seen).toEqual([{}, {}, {}]);
  });
});
