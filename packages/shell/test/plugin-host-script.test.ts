import { describe, expect, it } from "vitest";
// @ts-expect-error a plain ES module served to the sandbox
import { runHost } from "../resources/plugin-host.mjs";

// biome-ignore lint/suspicious/noExplicitAny: the backend's ctx is untyped here, as in a plugin's plain JS
type Any = any;

function fakeRpc(commands: unknown[]) {
  const calls: [string, unknown][] = [];
  const rpc = async (method: string, args: unknown) => {
    calls.push([method, args]);
    if (method === "next") return commands.shift() ?? new Promise(() => {});
    if (method === "ctx") {
      const { name } = args as { name: string };
      if (name === "fetch") return { ok: true, value: { url: "u", status: 200, ok: true, headers: {}, text: '{"a":1}' } };
      if (name === "exec") return { ok: false, refused: "not declared" };
      return { ok: true, value: null };
    }
    return null;
  };
  return { rpc, calls };
}

const settle = () => new Promise((r) => setTimeout(r, 20));

describe("the core host script (Decision 10)", () => {
  it("reports ready with the backend's sources, runs a command, wraps fetch, turns refusals into PluginRefused", async () => {
    const seen: string[] = [];
    const backend = {
      default: {
        sources: {
          queues: async (ctx: Any) => {
            const r = await ctx.fetch("https://x.atlassian.net/");
            seen.push(JSON.stringify(r.json()), r.text());
            try {
              await ctx.exec("gh", []);
            } catch (e: Any) {
              seen.push(`${e.name}: ${e.message}`);
            }
          },
        },
      },
    };
    const { rpc, calls } = fakeRpc([{ kind: "run", runId: "r1", source: "queues" }]);
    void runHost(rpc, async () => backend);
    await settle();
    expect(calls[0]).toEqual(["ready", { sources: ["queues"] }]);
    expect(seen).toEqual(['{"a":1}', '{"a":1}', "PluginRefused: not declared"]);
    expect(calls.find(([m]) => m === "done")).toEqual(["done", { runId: "r1", ok: true }]);
  });

  it("every ctx call carries the run id and its arguments, trailing undefined ones dropped (JSON makes a middle one null)", async () => {
    const backend = {
      default: {
        sources: {
          s: async (ctx: Any) => {
            await ctx.settings.get();
            await ctx.data.query("results");
            await ctx.data.patch("results", undefined, { a: 1 });
            await ctx.attention.raise({ key: "k", severity: "info", title: "T" });
            await ctx.chip.set("c", { text: "3" });
            await ctx.log("info", "hi");
          },
        },
      },
    };
    const { rpc, calls } = fakeRpc([{ kind: "run", runId: "r9", source: "s" }]);
    void runHost(rpc, async () => backend);
    await settle();
    expect(calls.filter(([m]) => m === "ctx").map(([, a]) => a)).toEqual([
      { runId: "r9", name: "settings.get", args: [] },
      { runId: "r9", name: "data.query", args: ["results"] },
      { runId: "r9", name: "data.patch", args: ["results", undefined, { a: 1 }] },
      { runId: "r9", name: "attention.raise", args: [{ key: "k", severity: "info", title: "T" }] },
      { runId: "r9", name: "chip.set", args: ["c", { text: "3" }] },
      { runId: "r9", name: "log", args: ["info", "hi"] },
    ]);
  });

  it("a backend that fails to import reports the error and stops", async () => {
    const { rpc, calls } = fakeRpc([]);
    await runHost(rpc, async () => {
      throw new SyntaxError("Unexpected token");
    });
    expect(calls).toEqual([["ready", { error: "SyntaxError: Unexpected token" }]]);
  });

  it("an unknown source or a throwing source reports done with ok false; idle answers are skipped", async () => {
    const { rpc, calls } = fakeRpc([{ kind: "idle" }, { kind: "run", runId: "r1", source: "nope" }, { kind: "run", runId: "r2", source: "boom" }]);
    void runHost(rpc, async () => ({
      default: {
        sources: {
          boom: async () => {
            throw new Error("HTTP 500");
          },
        },
      },
    }));
    await settle();
    expect(calls.filter(([m]) => m === "done")).toEqual([
      ["done", { runId: "r1", ok: false, error: 'No source "nope"' }],
      ["done", { runId: "r2", ok: false, error: "HTTP 500" }],
    ]);
  });

  it("an error text is cut to 500 characters; an inherited name is no source", async () => {
    const { rpc, calls } = fakeRpc([
      { kind: "run", runId: "r1", source: "long" },
      { kind: "run", runId: "r2", source: "toString" },
    ]);
    void runHost(rpc, async () => ({
      default: {
        sources: {
          long: async () => {
            throw new Error("x".repeat(2000));
          },
        },
      },
    }));
    await settle();
    const done = calls.filter(([m]) => m === "done").map(([, a]) => a as { error: string });
    expect(done[0]!.error).toHaveLength(500);
    expect(done[1]!.error).toBe('No source "toString"');
  });

  it("stops pulling when main refuses next (the page is gone or not ready)", async () => {
    const calls: string[] = [];
    const rpc = async (method: string) => {
      calls.push(method);
      if (method === "next") throw new Error("The plugin's backend stopped");
      return null;
    };
    await runHost(rpc, async () => ({ default: { sources: {} } }));
    expect(calls).toEqual(["ready", "next"]);
  });
});
