import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { TOOLS_IPC_ARGS_MAX_BYTES, TOOLS_IPC_CHANNELS, registerToolsIpc } from "../../src/main/tools/tools-ipc";

function wire(over: Record<string, unknown> = {}) {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const calls: unknown[][] = [];
  const host = {
    uiCall: async (id: string, args: unknown) => (calls.push(["uiCall", id, args]), { ok: true, result: 3 }),
    trace: async (id: string) => (calls.push(["trace", id]), []),
    ...over,
  };
  registerToolsIpc((ch, fn) => void handlers.set(ch, fn), host as never);
  const call = (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
  return { handlers, call, calls };
}

const INVALID = { ok: false, error: "Invalid request" };

describe("tools IPC (tools spec §5; T9)", () => {
  it("registers exactly hh:toolsCall and hh:toolsTrace", () => {
    const w = wire();
    expect([...w.handlers.keys()].sort()).toEqual(["hh:toolsCall", "hh:toolsTrace"]);
    expect([...TOOLS_IPC_CHANNELS].sort()).toEqual(["hh:toolsCall", "hh:toolsTrace"]);
  });

  it("hh:toolsCall traces caller ui with the open scope and no task; a bad id or args over 1 MB answer Invalid request (T9)", async () => {
    const w = wire();
    // Only the id and the arguments reach the host's UI call (which runs as "ui" in main's open scope): extra values the
    // page sends (a caller, a task, a scope) are dropped.
    expect(await w.call("hh:toolsCall", "count", { n: 1 }, { caller: "agent", task: "t1", scope: "other" })).toEqual({ ok: true, result: 3 });
    expect(await w.call("hh:toolsCall", "count")).toEqual({ ok: true, result: 3 });
    expect(w.calls).toEqual([
      ["uiCall", "count", { n: 1 }],
      ["uiCall", "count", undefined],
    ]);
    expect(await w.call("hh:toolsCall", 42, {})).toEqual(INVALID);
    expect(await w.call("hh:toolsCall", "Count", {})).toEqual(INVALID);
    expect(await w.call("hh:toolsCall", "../x", {})).toEqual(INVALID);
    expect(await w.call("hh:toolsCall", "count", { big: "x".repeat(TOOLS_IPC_ARGS_MAX_BYTES) })).toEqual(INVALID);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(await w.call("hh:toolsCall", "count", loop)).toEqual(INVALID);
    expect(w.calls).toHaveLength(2);
  });

  it("a host that rejects answers a fixed text, never its error", async () => {
    const w = wire({ uiCall: () => Promise.reject(new Error("EACCES /Users/marco/x")), trace: () => Promise.reject(new Error("boom")) });
    expect(await w.call("hh:toolsCall", "count", {})).toEqual({ ok: false, error: "Something went wrong running the tool" });
    expect(await w.call("hh:toolsTrace", randomUUID())).toEqual([]);
  });

  it("hh:toolsTrace takes a task or run id (UUID-shaped) and refuses anything else", async () => {
    const w = wire();
    const id = randomUUID();
    expect(await w.call("hh:toolsTrace", id)).toEqual([]);
    for (const bad of ["../x", "a/b", "", "A-UPPER", 42, null, "x".repeat(300)]) expect(await w.call("hh:toolsTrace", bad)).toEqual([]);
    expect(w.calls).toEqual([["trace", id]]);
  });
});
