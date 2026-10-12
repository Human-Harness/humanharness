import { describe, expect, it, vi } from "vitest";
import type { Event, HarnessRuntime, LimitWindow } from "@humanharness/runtime";
import type { ChatEntry } from "@humanharness/ui";
import { EngineUnavailable, TurnController, memoise } from "../src/main/turn-controller";
import type { UsageMeta } from "../src/main/usage-log";

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
  const send = vi.fn((_m: string, e: Emit, _options?: unknown) => {
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

  it("is busy as soon as send is called and rejects a second send", async () => {
    const startup = deferred<HarnessRuntime | null>();
    const ensureRuntime = vi.fn(() => startup.promise);
    const { controller, entries } = setup({ ensureRuntime });
    const first = controller.send("one");
    expect(controller.isBusy()).toBe(true);
    await expect(controller.send("two")).rejects.toThrow();
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

  it("cancelled before startup never starts the runtime", async () => {
    const log = deferred<{ append: (e: ChatEntry) => Promise<void> } | null>();
    const ensureRuntime = vi.fn(async () => null);
    const events: Event[] = [];
    const controller = new TurnController({ ensureRuntime, chatLog: () => log.promise, stateBlocks: () => new Set(), emit: (e) => events.push(e) });
    const sent = controller.send("hi");
    controller.cancel();
    log.resolve({ append: async () => {} });
    await sent;
    expect(ensureRuntime).not.toHaveBeenCalled();
    expect(events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "cancelled" } });
  });

  it("close cancels the current turn and rejects later sends", async () => {
    const fake = fakeRuntime();
    const { controller, events } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("hi");
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    controller.close();
    await sent;
    expect(fake.cancel).toHaveBeenCalled();
    expect(events.at(-1)).toMatchObject({ type: "done", ok: false, error: { code: "cancelled" } });
    await expect(controller.send("again")).rejects.toThrow();
    expect(fake.send).toHaveBeenCalledTimes(1);
    expect(controller.isBusy()).toBe(false);
  });

  it("rejects send when there is no chat log (not configured)", async () => {
    const ensureRuntime = vi.fn(async () => null);
    const controller = new TurnController({ ensureRuntime, chatLog: async () => null, stateBlocks: () => new Set(), emit: () => {} });
    await expect(controller.send("hi")).rejects.toThrow();
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

describe("TurnController usage and actions", () => {
  it("tags the turn with its action and records usage before telling the window", async () => {
    const fake = fakeRuntime();
    const order: string[] = [];
    const entries: ChatEntry[] = [];
    const recorded: [ChatEntry, UsageMeta, LimitWindow[] | undefined][] = [];
    const controller = new TurnController({
      ensureRuntime: async () => fake.runtime,
      chatLog: async () => ({
        append: async (e) => {
          entries.push(e);
          order.push(`log:${e.role}`);
        },
      }),
      stateBlocks: () => new Set(["progress"]),
      emit: (e) => order.push(`emit:${e.type}`),
      recordUsage: async (entry, action, firstLimits) => {
        recorded.push([entry, action, firstLimits]);
        order.push("usage");
      },
    });
    const sent = controller.send("tidy up", { action: "tidy" });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    const first = [{ kind: "five_hour", utilization: 0.15, resetsAt: "2026-10-11T15:00:00.000Z" }];
    const windows = [{ kind: "five_hour", utilization: 0.2, resetsAt: "2026-10-11T15:00:00.000Z" }];
    fake.finish([
      { type: "limits", status: "allowed", windows: first },
      { type: "block", name: "progress", data: { percent: 50 } },
      { type: "limits", status: "allowed", windows },
      { type: "usage", inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0 },
      { type: "done", ok: true },
    ]);
    await sent;
    expect(entries[0]).toMatchObject({ role: "user", text: "tidy up", action: "tidy" });
    expect(entries[1]).toMatchObject({
      role: "assistant",
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 100, cacheWriteTokens: 0 },
      limits: windows,
      state: { progress: { percent: 50 } },
    });
    expect(recorded).toEqual([[entries[1], { action: "tidy" }, first]]);
    expect(order.slice(-3)).toEqual(["log:assistant", "usage", "emit:done"]);
  });

  it("still ends the turn when recording usage fails", async () => {
    const fake = fakeRuntime();
    const events: Event[] = [];
    const controller = new TurnController({
      ensureRuntime: async () => fake.runtime,
      chatLog: async () => ({ append: async () => {} }),
      stateBlocks: () => new Set(),
      emit: (e) => events.push(e),
      recordUsage: async () => {
        throw new Error("disk full");
      },
    });
    const sent = controller.send("hi");
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "done", ok: true }]);
    await sent;
    expect(events.at(-1)).toEqual({ type: "done", ok: true });
  });

  it("ends the turn with the engine's own error when it can't run", async () => {
    const { controller, events, entries } = setup({
      ensureRuntime: async () => {
        throw new EngineUnavailable("outdated-version");
      },
    });
    await controller.send("hi");
    expect(events.at(-1)).toEqual({ type: "done", ok: false, error: { code: "outdated-version" } });
    expect(entries.at(-1)?.error).toEqual({ code: "outdated-version" });
  });

  it("forgets the engine's test prompt before telling the window a session expired", async () => {
    const fake = fakeRuntime();
    const order: string[] = [];
    let engine = "codex";
    const controller = new TurnController({
      ensureRuntime: async () => fake.runtime,
      chatLog: async () => ({ append: async () => {} }),
      stateBlocks: () => new Set(),
      emit: (e) => order.push(`emit:${e.type}`),
      engineId: async () => engine,
      sessionExpired: async (id) => {
        order.push(`expired:${id}`);
        throw new Error("disk full");
      },
    });
    const sent = controller.send("hi");
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    // The engine the turn ran on, even if the setting changed meanwhile.
    engine = "claude";
    fake.finish([{ type: "done", ok: false, error: { code: "session-expired" } }]);
    await sent;
    expect(order).toEqual(["expired:codex", "emit:done"]);

    const other = fakeRuntime();
    const calls = vi.fn(async () => {});
    const c2 = new TurnController({
      ensureRuntime: async () => other.runtime,
      chatLog: async () => ({ append: async () => {} }),
      stateBlocks: () => new Set(),
      emit: () => {},
      sessionExpired: calls,
    });
    const s2 = c2.send("hi");
    await vi.waitFor(() => expect(other.send).toHaveBeenCalled());
    other.finish([{ type: "done", ok: false, error: { code: "out-of-quota" } }]);
    await s2;
    expect(calls).not.toHaveBeenCalled();
  });
});

describe("TurnController for tasks", () => {
  it("shows the display text and tags both entries with the task; the action only on the task's first turn", async () => {
    const fake = fakeRuntime();
    const { controller, entries } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("# Topic: engines\n(brief)", { action: "engines", task: "t1", display: "Engines" });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    expect(fake.send.mock.calls[0][0]).toBe("# Topic: engines\n(brief)");
    fake.finish([{ type: "text", delta: "Hi" }, { type: "done", ok: true }]);
    await sent;
    expect(entries[0]).toMatchObject({ role: "user", text: "Engines", action: "engines", task: "t1" });
    expect(entries[1]).toMatchObject({ role: "assistant", text: "Hi", task: "t1" });

    const next = fakeRuntime();
    const second = setup({ ensureRuntime: async () => next.runtime });
    const followUp = second.controller.send("And the blocks?", { action: "engines", task: "t1", followUp: true });
    await vi.waitFor(() => expect(next.send).toHaveBeenCalled());
    next.finish([{ type: "done", ok: true }]);
    await followUp;
    expect(second.entries[0].action).toBeUndefined();
    expect(second.entries[0]).toMatchObject({ text: "And the blocks?", task: "t1" });
  });

  it("runs a quiet closing turn: nothing in the chat or the window, usage tagged close, every event to onEvent", async () => {
    const fake = fakeRuntime();
    const entries: ChatEntry[] = [];
    const events: Event[] = [];
    const seen: Event[] = [];
    const recorded: [string | undefined, UsageMeta][] = [];
    const controller = new TurnController({
      ensureRuntime: async () => fake.runtime,
      chatLog: async () => ({ append: async (e) => void entries.push(e) }),
      stateBlocks: () => new Set(["save_note"]),
      emit: (e) => events.push(e),
      recordUsage: async (entry, meta) => void recorded.push([entry.task, meta]),
    });
    const sent = controller.send("close please", { action: "turn", task: "t1", phase: "close", quiet: true, onEvent: (e) => seen.push(e) });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([
      { type: "block", name: "save_note", data: { title: "T" } },
      { type: "usage", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { type: "done", ok: true },
    ]);
    await sent;
    expect(entries).toEqual([]);
    expect(events).toEqual([]);
    expect(seen.map((e) => e.type)).toEqual(["block", "usage", "done"]);
    expect(recorded).toEqual([["t1", { action: "turn", task: "t1", phase: "close" }]]);
  });

  it("still tells the window a quiet turn's plan limits and a failure, logging only the error", async () => {
    const fake = fakeRuntime();
    const entries: ChatEntry[] = [];
    const events: Event[] = [];
    const controller = new TurnController({
      ensureRuntime: async () => fake.runtime,
      chatLog: async () => ({ append: async (e) => void entries.push(e) }),
      stateBlocks: () => new Set(),
      emit: (e) => events.push(e),
    });
    const windows: LimitWindow[] = [{ kind: "five_hour", utilization: 0.4, resetsAt: "2026-10-12T18:00:00.000Z" }];
    const sent = controller.send("close please", { task: "t1", phase: "close", quiet: true });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([
      { type: "limits", status: "allowed", windows },
      { type: "text", delta: "Saving" },
      { type: "done", ok: false, error: { code: "session-expired" } },
    ]);
    await sent;
    expect(events).toEqual([
      { type: "limits", status: "allowed", windows },
      { type: "done", ok: false, error: { code: "session-expired" } },
    ]);
    expect(entries).toEqual([
      { id: expect.any(String), role: "assistant", text: "", blocks: [], activities: [], at: expect.any(String), error: { code: "session-expired" }, task: "t1" },
    ]);
  });

  it("keeps a cancelled quiet turn out of the window", async () => {
    const fake = fakeRuntime();
    const { controller, events, entries } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("close please", { quiet: true });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    controller.cancel();
    await sent;
    expect(events).toEqual([]);
    expect(entries).toEqual([]);
  });

  it("tells onEvent how the turn ended even when the engine can't start", async () => {
    const seen: Event[] = [];
    const { controller } = setup({ ensureRuntime: async () => null });
    await controller.send("hi", { onEvent: (e) => seen.push(e) });
    expect(seen).toEqual([{ type: "done", ok: false, error: { code: "engine-not-installed" } }]);
  });

  it("keeps context and compaction events from the window, but the caller sees them", async () => {
    const fake = fakeRuntime();
    const { controller, events } = setup({ ensureRuntime: async () => fake.runtime });
    const seen: string[] = [];
    const sent = controller.send("hi", { onEvent: (e) => seen.push(e.type) });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "context", used: 5 }, { type: "compaction" }, { type: "done", ok: true }]);
    await sent;
    expect(seen).toEqual(["context", "compaction", "done"]);
    expect(events.map((e) => e.type)).toEqual(["done"]);
  });

  it("runs the turn on the task's profile", async () => {
    const fake = fakeRuntime();
    const { controller } = setup({ ensureRuntime: async () => fake.runtime });
    const profile = { engine: "claude", tier: "deep" as const, model: "opus", effort: "high" as const, cap: 400_000 };
    const sent = controller.send("hi", { profile });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "done", ok: true }]);
    await sent;
    expect(fake.send.mock.calls[0][2]).toEqual({ profile });
  });

  it("holds a model-unavailable end for a retry: nothing logged or shown, the caller told", async () => {
    const fake = fakeRuntime();
    const { controller, entries, events } = setup({ ensureRuntime: async () => fake.runtime });
    const seen: Event[] = [];
    const sent = controller.send("hi", { holdModelError: true, onEvent: (e) => seen.push(e) });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "done", ok: false, error: { code: "model-unavailable" } }]);
    await sent;
    expect(entries.map((e) => e.role)).toEqual(["user"]);
    expect(events).toEqual([]);
    expect(seen).toEqual([{ type: "done", ok: false, error: { code: "model-unavailable" } }]);
  });

  it("a held attempt that fails shows nothing in the window, but its usage is recorded", async () => {
    const fake = fakeRuntime();
    const events: Event[] = [];
    const recorded: UsageMeta[] = [];
    const controller = new TurnController({
      ensureRuntime: async () => fake.runtime,
      chatLog: async () => ({ append: async () => {} }),
      stateBlocks: () => new Set(),
      emit: (e) => events.push(e),
      recordUsage: async (_entry, meta) => void recorded.push(meta),
    });
    const sent = controller.send("hi", { task: "t1", holdModelError: true });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([
      { type: "limits", status: "allowed", windows: [] },
      { type: "usage", inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { type: "done", ok: false, error: { code: "model-unavailable" } },
    ]);
    await sent;
    expect(events).toEqual([]);
    expect(recorded).toEqual([{ task: "t1" }]);
  });

  it("a held attempt whose model answers reaches the window in order, from its first content on", async () => {
    const fake = fakeRuntime();
    const { controller, events } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("hi", { holdModelError: true });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([
      { type: "limits", status: "allowed", windows: [] },
      { type: "text", delta: "Hello" },
      { type: "done", ok: true },
    ]);
    await sent;
    expect(events.map((e) => e.type)).toEqual(["limits", "text", "done"]);
  });

  it("a quiet turn holding its failure: nothing logged or shown, usage recorded, the caller told", async () => {
    const fake = fakeRuntime();
    const entries: ChatEntry[] = [];
    const events: Event[] = [];
    const recorded: UsageMeta[] = [];
    const seen: Event[] = [];
    const controller = new TurnController({
      ensureRuntime: async () => fake.runtime,
      chatLog: async () => ({ append: async (e) => void entries.push(e) }),
      stateBlocks: () => new Set(),
      emit: (e) => events.push(e),
      recordUsage: async (_entry, meta) => void recorded.push(meta),
    });
    const sent = controller.send("save", { task: "t1", phase: "checkpoint", quiet: true, holdFailure: true, onEvent: (e) => seen.push(e) });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([
      { type: "usage", inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
      { type: "done", ok: false, error: { code: "agent-crashed" } },
    ]);
    await sent;
    expect(entries).toEqual([]);
    expect(events).toEqual([]);
    expect(recorded).toEqual([{ task: "t1", phase: "checkpoint" }]);
    expect(seen.at(-1)).toEqual({ type: "done", ok: false, error: { code: "agent-crashed" } });
  });

  it("shows any other failure of a held turn as usual", async () => {
    const fake = fakeRuntime();
    const { controller, events } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("hi", { holdModelError: true });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "done", ok: false, error: { code: "out-of-quota" } }]);
    await sent;
    expect(events).toEqual([{ type: "done", ok: false, error: { code: "out-of-quota" } }]);
  });

  it("logs no user entry for the retry of a held turn", async () => {
    const fake = fakeRuntime();
    const { controller, entries } = setup({ ensureRuntime: async () => fake.runtime });
    const sent = controller.send("hi", { skipUserEntry: true });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "text", delta: "ok" }, { type: "done", ok: true }]);
    await sent;
    expect(entries.map((e) => e.role)).toEqual(["assistant"]);
  });
});
