import { describe, expect, it, vi } from "vitest";
import type { TaskContext } from "@humanharness/protocol";
import { askContext, contextApi, contextListener } from "../src/api";

describe("the panel's calls over the mod's ipc (context-panel spec §5.2)", () => {
  it("passes the call name and its arguments as an array and answers main's data", async () => {
    const call = vi.fn(async () => ({ ok: true }));
    expect(await askContext(call, "pin", "main", "a.md")).toEqual({ ok: true });
    expect(call).toHaveBeenCalledWith("pin", ["main", "a.md"]);
  });

  it("a rejected call, an answer that is not data, or no ipc at all is 'failed', never a throw", async () => {
    const failed = { ok: false, reason: "failed" };
    expect(await askContext(async () => Promise.reject(new Error("no handler")), "get", "t1")).toEqual(failed);
    expect(await askContext(async () => undefined, "get", "t1")).toEqual(failed);
    expect(
      await askContext(() => {
        throw new Error("sync");
      }, "get", "t1"),
    ).toEqual(failed);
    expect(await askContext(undefined, "get", "t1")).toEqual(failed);
  });

  it("hears only its task's updates", () => {
    const got: TaskContext[] = [];
    const l = contextListener("t1", (c) => got.push(c));
    const c = { task: "t1" } as TaskContext;
    l({ task: "t2", context: c });
    l({ task: "t1" });
    l(null);
    l({ task: "t1", context: c });
    expect(got).toEqual([c]);
  });

  it("the api calls the seven names and listens to the `changed` push", async () => {
    const call = vi.fn(async () => ({ ok: true }));
    let heard: ((v: unknown) => void) | undefined;
    const off = vi.fn();
    const on = vi.fn((_name: string, fn: (v: unknown) => void) => ((heard = fn), off));
    const api = contextApi({ call, on });
    await api.get("t1");
    await api.add("t1", "a.md");
    await api.pick();
    await api.pin("main", "a.md");
    await api.unpin("main", "a.md");
    await api.exclude("main", "n.md");
    await api.include("main", "n.md");
    expect((call.mock.calls as unknown as string[][]).map((c) => c[0])).toEqual(["get", "add", "pick", "pin", "unpin", "exclude", "include"]);
    const got: TaskContext[] = [];
    expect(api.onChange("t1", (c) => got.push(c))).toBe(off);
    expect(on).toHaveBeenCalledWith("changed", expect.any(Function));
    heard!({ task: "t1", context: { task: "t1" } });
    expect(got).toHaveLength(1);
  });

  it("with no ui ipc the api answers failed and listens to nothing", async () => {
    const api = contextApi({});
    expect(await api.get("t1")).toEqual({ ok: false, reason: "failed" });
    expect(() => api.onChange("t1", () => {})()).not.toThrow();
  });
});
