import { describe, expect, it, vi } from "vitest";
import type { Event, HarnessRuntime } from "@humanharness/runtime";
import type { ChatEntry } from "@humanharness/ui";
import { TurnController, memoise } from "../src/main/turn-controller";

type Emit = (e: Event) => void;

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A runtime whose turn ends when the test calls `finish` (or cancels). */
function fakeRuntime() {
  let emit: Emit = () => {};
  const end = deferred<void>();
  const cancel = vi.fn(() => {
    emit({ type: "done", ok: false, error: { code: "cancelled" } });
    end.resolve();
  });
  const send = vi.fn((_m: string, e: Emit) => {
    emit = e;
    return { cancel, done: end.promise };
  });
  const runtime = { send, history: {}, close: async () => {} } as unknown as HarnessRuntime;
  return {
    runtime,
    send,
    cancel,
    finish(events: Event[]) {
      for (const e of events) emit(e);
      end.resolve();
    },
  };
}

function setup(
  opts: {
    ensureRuntime?: () => Promise<HarnessRuntime | null>;
    append?: (e: ChatEntry) => Promise<void>;
    emit?: (e: Event) => void;
  } = {},
) {
  const order: string[] = [];
  const entries: ChatEntry[] = [];
  const events: Event[] = [];
  const append =
    opts.append ??
    (async (e: ChatEntry) => {
      entries.push(e);
      order.push(`log:${e.role}`);
    });
  const controller = new TurnController({
    ensureRuntime: opts.ensureRuntime ?? (async () => null),
    chatLog: async () => ({ append }),
    stateBlocks: () => new Set(),
    emit: (e) => {
      order.push(`emit:${e.type}`);
      events.push(e);
      opts.emit?.(e);
    },
  });
  return { controller, order, entries, events };
}

describe("TurnController", () => {
  it("runs a turn, logging the reply before emitting done", async () => {
    const fake = fakeRuntime();
    const { controller, order, entries } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("hi");
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "text", delta: "Hello" }, { type: "done", ok: true }]);
    await sent;
    expect(order).toEqual(["log:user", "emit:text", "log:assistant", "emit:done"]);
    expect(entries.map((e) => e.text)).toEqual(["hi", "Hello"]);
    expect(controller.isBusy()).toBe(false);
  });

  it("is busy as soon as send is called and refuses a second send", async () => {
    const startup = deferred<HarnessRuntime | null>();
    const ensureRuntime = vi.fn(() => startup.promise);
    const { controller, entries } = setup({ ensureRuntime });
    const first = controller.send("one");
    expect(controller.isBusy()).toBe(true);
    await controller.send("two");
    startup.resolve(null);
    await first;
    expect(ensureRuntime).toHaveBeenCalledTimes(1);
    expect(entries.filter((e) => e.role === "user").map((e) => e.text)).toEqual(["one"]);
    expect(controller.isBusy()).toBe(false);
  });

  it("cancel during startup ends the turn as cancelled without starting the engine turn", async () => {
    const startup = deferred<HarnessRuntime | null>();
    const fake = fakeRuntime();
    const { controller, events, entries } = setup({ ensureRuntime: () => startup.promise });
    const sent = controller.send("hi");
    controller.cancel();
    startup.resolve(fake.runtime);
    await sent;
    expect(fake.send).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "cancelled" } });
    expect(entries.at(-1)?.error).toEqual({ code: "cancelled" });
  });

  it("cancel during the engine turn cancels it", async () => {
    const fake = fakeRuntime();
    const { controller, events } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("hi");
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    controller.cancel();
    await sent;
    expect(fake.cancel).toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "cancelled" } });
  });

  it("reports a missing engine and a failed startup", async () => {
    const a = setup({ ensureRuntime: async () => null });
    await a.controller.send("hi");
    expect(a.events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "engine-not-installed" } });
    const b = setup({ ensureRuntime: async () => Promise.reject(new Error("boom")) });
    await b.controller.send("hi");
    expect(b.events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "agent-crashed", detail: "boom" } });
    expect(b.entries.at(-1)?.error).toEqual({ code: "agent-crashed", detail: "boom" });
  });

  it("keeps the log entry when emit throws (closed window)", async () => {
    const fake = fakeRuntime();
    const { controller, entries } = setup({
      ensureRuntime: async () => fake.runtime,
      emit: () => {
        throw new Error("Object has been destroyed");
      },
    });
    const sent = controller.send("hi");
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "text", delta: "Reply" }, { type: "done", ok: true }]);
    await expect(sent).resolves.toBeUndefined();
    expect(entries.map((e) => e.text)).toEqual(["hi", "Reply"]);
  });

  it("does not reject when the log cannot be written, and still emits done", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { controller, events } = setup({ append: async () => Promise.reject(new Error("disk full")) });
    await expect(controller.send("hi")).resolves.toBeUndefined();
    await expect(controller.flush()).resolves.toBeUndefined();
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });

  it("flush waits for pending log writes", async () => {
    const write = deferred<void>();
    let written = 0;
    const { controller } = setup({
      append: async () => {
        await write.promise;
        written++;
      },
    });
    const sent = controller.send("hi");
    const flushed = controller.flush().then(() => written);
    setTimeout(() => write.resolve(), 10);
    expect(await flushed).toBeGreaterThan(0);
    await sent;
  });

  it("ignores send when there is no chat log (not configured)", async () => {
    const ensureRuntime = vi.fn(async () => null);
    const controller = new TurnController({ ensureRuntime, chatLog: async () => null, stateBlocks: () => new Set(), emit: () => {} });
    await controller.send("hi");
    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(controller.isBusy()).toBe(false);
  });
});

describe("memoise", () => {
  it("shares one in-flight call and keeps the result", async () => {
    const d = deferred<string | null>();
    const fn = vi.fn(() => d.promise);
    const m = memoise(fn);
    const a = m.get();
    const b = m.get();
    d.resolve("rt");
    expect(await a).toBe("rt");
    expect(await b).toBe("rt");
    expect(await m.get()).toBe("rt");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(await m.peek()).toBe("rt");
  });

  it("retries after a failure or a null result", async () => {
    const fn = vi.fn<() => Promise<string | null>>().mockRejectedValueOnce(new Error("x")).mockResolvedValueOnce(null).mockResolvedValueOnce("ok");
    const m = memoise(fn);
    await expect(m.get()).rejects.toThrow("x");
    expect(m.peek()).toBeNull();
    expect(await m.get()).toBeNull();
    expect(await m.get()).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
