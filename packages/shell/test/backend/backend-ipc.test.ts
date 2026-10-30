import { describe, expect, it, vi } from "vitest";
import { BackendGeneration, type BackendIpcSupervisor, registerBackendIpc } from "../../src/main/backend/backend-ipc";
import type { BackendState } from "../../src/main/backend/backend-supervisor";

/** The channels registered, by name, as `handle()` would keep them. */
function rig(state: BackendState = "running", call?: (method: string, params: unknown) => Promise<unknown>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const box = { current: state };
  const supervisor = {
    get current(): BackendState {
      return box.current;
    },
    set current(s: BackendState) {
      box.current = s;
    },
    state: vi.fn((): BackendState => box.current),
    call: vi.fn(call ?? (async (method: string, params: unknown): Promise<unknown> => ({ method, params }))),
    restart: vi.fn(async (): Promise<void> => {
      box.current = "running";
    }),
  } satisfies BackendIpcSupervisor & { current: BackendState };
  registerBackendIpc((channel, fn) => void handlers.set(channel, fn as (...args: unknown[]) => unknown), { supervisor });
  const invoke = (channel: string, ...args: unknown[]) => Promise.resolve().then(() => handlers.get(channel)!(...args));
  return { handlers, supervisor, invoke };
}

describe("registerBackendIpc (threat model B2)", () => {
  it("registers exactly the backend's three channels", () => {
    expect([...rig().handlers.keys()].sort()).toEqual(["hh:backendCall", "hh:backendRestart", "hh:backendState"]);
  });

  it("hh:backendCall forwards a valid method and params and answers the result", async () => {
    const { supervisor, invoke } = rig();
    expect(await invoke("hh:backendCall", "echo", { a: 1 })).toEqual({ method: "echo", params: { a: 1 } });
    expect(await invoke("hh:backendCall", "ns.list:all_v-2")).toEqual({ method: "ns.list:all_v-2", params: undefined });
    expect(supervisor.call.mock.calls).toEqual([
      ["echo", { a: 1 }],
      ["ns.list:all_v-2", undefined],
    ]);
  });

  it.each([[""], ["has space"], ["x".repeat(101)], [42], ["1abc"], [null], [{ toString: () => "echo" }]])("refuses method %j (B2)", async (method) => {
    const { supervisor, invoke } = rig();
    await expect(invoke("hh:backendCall", method, {})).rejects.toThrow("Invalid backend method");
    expect(supervisor.call).not.toHaveBeenCalled();
  });

  it("refuses params that can't be serialised or exceed 1 MB (B2)", async () => {
    const { supervisor, invoke } = rig();
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(invoke("hh:backendCall", "echo", cyclic)).rejects.toThrow("The call's params can't be sent to the backend");
    await expect(invoke("hh:backendCall", "echo", 10n)).rejects.toThrow("The call's params can't be sent to the backend");
    await expect(invoke("hh:backendCall", "echo", "x".repeat(1024 * 1024 + 1))).rejects.toThrow("Too large");
    expect(supervisor.call).not.toHaveBeenCalled();
  });

  it("refuses more than 64 calls in flight, and takes calls again once they end", async () => {
    const waiting: (() => void)[] = [];
    const { supervisor, invoke } = rig("running", () => new Promise((r) => waiting.push(() => r("ok"))));
    const calls = Array.from({ length: 64 }, () => invoke("hh:backendCall", "slow"));
    await new Promise((r) => setTimeout(r, 0));
    await expect(invoke("hh:backendCall", "slow")).rejects.toThrow("Too many calls to the backend");
    expect(supervisor.call).toHaveBeenCalledTimes(64);
    for (const w of waiting) w();
    expect(await Promise.all(calls)).toHaveLength(64);
    const next = invoke("hh:backendCall", "slow");
    await new Promise((r) => setTimeout(r, 0));
    waiting.at(-1)!();
    expect(await next).toBe("ok");
  });

  it("a failed call frees its slot and rejects with the backend's message, cut to 500 characters (Decision 8)", async () => {
    const { invoke } = rig("running", async () => {
      throw new Error("y".repeat(900));
    });
    for (let i = 0; i < 70; i++) {
      const err = (await invoke("hh:backendCall", "boom").catch((e: unknown) => e)) as Error;
      expect(err.message).toBe("y".repeat(500));
    }
  });

  it("hh:backendState answers the supervisor's state; hh:backendRestart restarts only from failed", async () => {
    const { supervisor, invoke } = rig("running");
    expect(await invoke("hh:backendState")).toBe("running");
    await invoke("hh:backendRestart");
    expect(supervisor.restart).not.toHaveBeenCalled();
    supervisor.current = "starting";
    await invoke("hh:backendRestart");
    expect(supervisor.restart).not.toHaveBeenCalled();
    supervisor.current = "failed";
    expect(await invoke("hh:backendState")).toBe("failed");
    await invoke("hh:backendRestart");
    expect(supervisor.restart).toHaveBeenCalledTimes(1);
    expect(await invoke("hh:backendState")).toBe("running");
  });
});

describe("BackendGeneration (a stale scopes read is dropped)", () => {
  it("a read with no base change in between gives its value", async () => {
    const gen = new BackendGeneration();
    gen.bump();
    await expect(gen.readFresh(async () => "scopes")).resolves.toBe("scopes");
  });

  it("a read that a base change overtakes gives null", async () => {
    const gen = new BackendGeneration();
    let finish!: (v: string) => void;
    const read = gen.readFresh(() => new Promise<string>((r) => (finish = r)));
    gen.bump();
    finish("old scopes");
    await expect(read).resolves.toBeNull();
    await expect(gen.readFresh(async () => "new scopes")).resolves.toBe("new scopes");
  });

  it("a read that gives null stays null", async () => {
    await expect(new BackendGeneration().readFresh(async () => null)).resolves.toBeNull();
  });
});
