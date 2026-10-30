import { describe, expect, it, vi } from "vitest";
import type { TaskContext } from "@humanharness/protocol";
import { askContext, contextListener } from "../src/preload/context";

describe("client.context in the preload (context-panel spec §5.2)", () => {
  it("passes the channel and arguments and answers main's data", async () => {
    const invoke = vi.fn(async () => ({ ok: true }));
    expect(await askContext(invoke, "hh:contextPin", "main", "a.md")).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("hh:contextPin", "main", "a.md");
  });

  it("a rejected invoke or an answer that is not data is 'failed', never a throw", async () => {
    expect(await askContext(async () => Promise.reject(new Error("no handler")), "hh:contextGet", "t1")).toEqual({ ok: false, reason: "failed" });
    expect(await askContext(async () => undefined, "hh:contextGet", "t1")).toEqual({ ok: false, reason: "failed" });
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
});
