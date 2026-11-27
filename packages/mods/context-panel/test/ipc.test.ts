import { describe, expect, it, vi } from "vitest";
import { CONTEXT_CALLS } from "../src/api";
import { contextHandlers } from "../src/ipc";
import type { ContextService } from "../src/service";

describe("context ipc handlers (context-panel spec §5.2)", () => {
  it("pass their arguments through and answer the service's data", async () => {
    const svc = {
      get: vi.fn(async () => ({ ok: false, reason: "no-task" })),
      add: vi.fn(async () => ({ ok: true })),
      pick: vi.fn(async () => ({ ok: false, reason: "cancelled" })),
      pin: vi.fn(async () => ({ ok: true })),
      unpin: vi.fn(async () => ({ ok: true })),
      exclude: vi.fn(async () => ({ ok: true })),
      include: vi.fn(async () => ({ ok: true })),
    } as unknown as ContextService;
    const h = contextHandlers(svc);
    expect(Object.keys(h).sort()).toEqual([...CONTEXT_CALLS].sort());
    expect(await h["get"]("t1")).toEqual({ ok: false, reason: "no-task" });
    expect(await h["pin"]("main", "a.md")).toEqual({ ok: true });
    expect(svc.pin).toHaveBeenCalledWith("main", "a.md");
    expect(await h["add"]("t1", "a.md")).toEqual({ ok: true });
    expect(svc.add).toHaveBeenCalledWith("t1", "a.md");
    expect(await h["pick"]()).toEqual({ ok: false, reason: "cancelled" });
    expect(await h["unpin"]("main", "a.md")).toEqual({ ok: true });
    expect(svc.unpin).toHaveBeenCalledWith("main", "a.md");
    expect(await h["exclude"]("main", ".harness/notes/n.md")).toEqual({ ok: true });
    expect(svc.exclude).toHaveBeenCalledWith("main", ".harness/notes/n.md");
    expect(await h["include"]("main", ".harness/notes/n.md")).toEqual({ ok: true });
    expect(svc.include).toHaveBeenCalledWith("main", ".harness/notes/n.md");
  });

  it("a throw is a bug: logged, answered as data", async () => {
    const svc = {
      pin: vi.fn(async () => Promise.reject(new Error("boom"))),
      get: vi.fn(() => {
        throw new Error("sync boom");
      }),
    } as unknown as ContextService;
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await contextHandlers(svc)["pin"]("main", "a.md")).toEqual({ ok: false, reason: "failed" });
    expect(await contextHandlers(svc)["get"]("t1")).toEqual({ ok: false, reason: "failed" });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
