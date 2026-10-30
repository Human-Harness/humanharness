import { describe, expect, it } from "vitest";
import { CONNECTIONS_IPC_CHANNELS, registerConnectionsIpc } from "../../src/main/secrets/connections-ipc";

const VIEW = { connections: [{ id: "jira", label: "Jira API token", set: false }] };

function wire(over: Record<string, unknown> = {}) {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const calls: unknown[][] = [];
  const rec =
    (name: string, answer: unknown = { ok: true }) =>
    async (...args: unknown[]) => (calls.push([name, ...args]), answer);
  const ctl = { view: rec("view", VIEW), set: rec("set"), delete: rec("delete"), ...over };
  registerConnectionsIpc((ch, fn) => void handlers.set(ch, fn), ctl as never);
  const call = (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
  return { handlers, call, calls };
}

const INVALID = { ok: false, message: "Invalid request" };
const WRONG = { ok: false, message: "Something went wrong" };
const reject = () => Promise.reject(new Error("boom tok-123456789"));

describe("connections IPC (tools spec §9)", () => {
  it("registers exactly CONNECTIONS_IPC_CHANNELS", async () => {
    const w = wire();
    expect([...w.handlers.keys()].sort()).toEqual([...CONNECTIONS_IPC_CHANNELS].sort());
    expect([...CONNECTIONS_IPC_CHANNELS].sort()).toEqual(["hh:connectionsDelete", "hh:connectionsGet", "hh:connectionsSet"]);
    // Well-formed calls reach the controller as they came.
    expect(await w.call("hh:connectionsGet")).toEqual(VIEW);
    expect(await w.call("hh:connectionsSet", "jira", "tok-123456789")).toEqual({ ok: true });
    expect(await w.call("hh:connectionsDelete", "jira")).toEqual({ ok: true });
    expect(w.calls).toEqual([["view"], ["set", "jira", "tok-123456789"], ["delete", "jira"]]);
  });

  it("undeclared, too long or non-string ids are refused", async () => {
    const w = wire();
    expect(await w.call("hh:connectionsSet", 42, "x")).toEqual(INVALID);
    expect(await w.call("hh:connectionsSet", "a".repeat(41), "tok-123456789")).toEqual(INVALID);
    expect(await w.call("hh:connectionsSet", "Jira", "tok-123456789")).toEqual(INVALID);
    expect(await w.call("hh:connectionsSet", "jira", 42)).toEqual(INVALID);
    expect(await w.call("hh:connectionsSet", "jira", "x".repeat(8193 * 4 + 1))).toEqual(INVALID);
    expect(await w.call("hh:connectionsSet", "jira")).toEqual(INVALID);
    expect(await w.call("hh:connectionsDelete", 42)).toEqual(INVALID);
    expect(await w.call("hh:connectionsDelete", "a".repeat(41))).toEqual(INVALID);
    expect(await w.call("hh:connectionsDelete", "../jira")).toEqual(INVALID);
    expect(w.calls).toEqual([]);
  });

  it("a controller that rejects answers a fixed refusal", async () => {
    const w = wire({ view: reject, set: reject, delete: reject });
    expect(await w.call("hh:connectionsSet", "jira", "tok-123456789")).toEqual(WRONG);
    expect(await w.call("hh:connectionsDelete", "jira")).toEqual(WRONG);
    expect(await w.call("hh:connectionsGet")).toBeNull();
  });
});
