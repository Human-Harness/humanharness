import { describe, expect, it, vi } from "vitest";
import type { Event, SessionSlot } from "@humanharness/runtime";
import { gatedTurns } from "../src/main/gated-turns";
import { TurnController } from "../src/main/turn-controller";
import { TurnGate } from "../src/main/turn-gate";

type Options = { onEvent?: (e: Event) => void };

function fakeTurns() {
  const pending: { resolve: () => void; reject: (e: unknown) => void; options: Options }[] = [];
  return {
    pending,
    send: vi.fn((_m: string, options: Options) => new Promise<void>((resolve, reject) => pending.push({ resolve, reject, options }))),
    isBusy: vi.fn(() => pending.length > 0),
    cancel: vi.fn(),
  };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const cancelled: Event = { type: "done", ok: false, error: { code: "cancelled" } };

describe("gatedTurns (parallel spec §7)", () => {
  it("a turn over the cap waits; the lane says queued; it runs when a slot frees", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const a = fakeTurns();
    const b = fakeTurns();
    const ga = gatedTurns("a", gate, a, { cap: "tasks" });
    const gb = gatedTurns("b", gate, b, { cap: "tasks" });
    const pa = ga.send("one", {});
    await flush();
    const pb = gb.send("two", {});
    await flush();
    expect(b.send).not.toHaveBeenCalled();
    expect(gb.isQueued()).toBe(true);
    expect(gb.isBusy()).toBe(true);
    a.pending[0].resolve();
    await pa;
    await flush();
    expect(b.send).toHaveBeenCalledWith("two", expect.anything());
    expect(gb.isQueued()).toBe(false);
    b.pending[0].resolve();
    await pb;
    expect(gate.running("tasks")).toBe(0);
  });

  it("a free gate starts the turn with no await (D0: cap 1 starts exactly when today's app does)", () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const a = fakeTurns();
    void gatedTurns("a", gate, a, { cap: "tasks" }).send("one", {});
    expect(a.send).toHaveBeenCalledTimes(1);
    expect(gate.running("tasks")).toBe(1);
  });

  it("cancel while queued drops it: send resolves, the window and the caller get a cancelled done, nothing is left", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const a = fakeTurns();
    const b = fakeTurns();
    const emitted: Event[] = [];
    const seen: Event[] = [];
    void gatedTurns("a", gate, a, { cap: "tasks" }).send("one", {});
    await flush();
    const gb = gatedTurns("b", gate, b, { cap: "tasks", emit: (e) => emitted.push(e) });
    const pb = gb.send("two", { onEvent: (e) => seen.push(e) });
    await flush();
    gb.cancel();
    await pb;
    expect(b.send).not.toHaveBeenCalled();
    expect(b.cancel).not.toHaveBeenCalled();
    expect(emitted).toEqual([cancelled]);
    expect(seen).toEqual([cancelled]);
    expect(gb.isBusy()).toBe(false);
    expect(gb.isQueued()).toBe(false);
    expect(gate.queued("tasks")).toEqual([]);
    expect(gate.running("tasks")).toBe(1);
    a.pending[0].resolve();
    await flush();
    expect(gate.running("tasks")).toBe(0);
  });

  it("a dropped quiet turn tells only the caller (as TurnController does with a quiet cancel)", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const a = fakeTurns();
    const emitted: Event[] = [];
    const seen: Event[] = [];
    void gatedTurns("a", gate, a, { cap: "tasks" }).send("one", {});
    const gb = gatedTurns("b", gate, fakeTurns(), { cap: "tasks", emit: (e) => emitted.push(e) });
    const pb = gb.send("checkpoint", { quiet: true, onEvent: (e) => seen.push(e) });
    await flush();
    expect(gate.drop("b")).toBe("checkpoint");
    await pb;
    expect(emitted).toEqual([]);
    expect(seen).toEqual([cancelled]);
  });

  it("cancel while beforeStart runs (neither queued nor running) still drops the turn and frees its slot", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 }, { hold: { singleSession: true } });
    let ready!: () => void;
    gate.setBeforeStart(() => new Promise<void>((r) => (ready = r)));
    const a = fakeTurns();
    const emitted: Event[] = [];
    const ga = gatedTurns("a", gate, a, { cap: "tasks", emit: (e) => emitted.push(e) });
    const pa = ga.send("one", {});
    await flush();
    expect(ga.isQueued()).toBe(false);
    expect(ga.isBusy()).toBe(true);
    ga.cancel();
    await pa;
    ready();
    await flush();
    expect(a.send).not.toHaveBeenCalled();
    expect(a.cancel).not.toHaveBeenCalled();
    expect(emitted).toEqual([cancelled]);
    expect(ga.isBusy()).toBe(false);
    expect(gate.running("tasks")).toBe(0);
  });

  it("cancel after the gate let the turn in but before it started: dropped, its slot freed once", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    gate.pause({ reason: "folder-move" });
    const a = fakeTurns();
    const emitted: Event[] = [];
    const ga = gatedTurns("a", gate, a, { cap: "tasks", emit: (e) => emitted.push(e) });
    const pa = ga.send("one", {});
    await flush();
    gate.resume(); // the slot is taken now; the send hasn't seen it yet
    expect(ga.isQueued()).toBe(false);
    ga.cancel();
    await pa;
    expect(a.send).not.toHaveBeenCalled();
    expect(emitted).toEqual([cancelled]);
    expect(gate.running("tasks")).toBe(0);
  });

  it("a turn the gate couldn't get ready ends with a failed done; the lane is free again", async () => {
    const error = new Error("sleep failed");
    const gate = {
      tryAcquire: vi.fn(() => null),
      acquire: vi.fn(() => Promise.reject(error)),
      isQueued: vi.fn(() => false),
      drop: vi.fn(() => null),
    } as unknown as TurnGate;
    const a = fakeTurns();
    const emitted: Event[] = [];
    const seen: Event[] = [];
    const quietSeen: Event[] = [];
    const ga = gatedTurns("a", gate, a, { cap: "tasks", emit: (e) => emitted.push(e) });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await ga.send("one", { onEvent: (e) => seen.push(e) });
    await ga.send("checkpoint", { quiet: true, onEvent: (e) => quietSeen.push(e) });
    log.mockRestore();
    const failed: Event = { type: "done", ok: false, error: { code: "agent-crashed", detail: "Couldn't get ready for this turn" } };
    expect(a.send).not.toHaveBeenCalled();
    expect(seen).toEqual([failed]);
    expect(quietSeen).toEqual([failed]);
    expect(emitted).toEqual([failed, failed]);
    expect(ga.isBusy()).toBe(false);
  });

  it("with `startFailed`, a turn the gate couldn't get ready goes there: the turn's own failed start writes the chat", async () => {
    const error = new Error("sleep failed");
    const gate = {
      tryAcquire: vi.fn(() => null),
      acquire: vi.fn(() => Promise.reject(error)),
      isQueued: vi.fn(() => false),
      drop: vi.fn(() => null),
    } as unknown as TurnGate;
    const chat: { role: string; text: string; error?: unknown }[] = [];
    const emitted: Event[] = [];
    let startError: Error | null = null;
    const controller = new TurnController({
      ensureRuntime: async () => {
        const e = startError;
        startError = null;
        if (e) throw new Error("Couldn't get ready for this turn");
        throw new Error("never reached");
      },
      chatLog: async () => ({ append: async (entry) => void chat.push(entry) }),
      stateBlocks: () => new Set(),
      emit: (e) => emitted.push(e),
    });
    const seen: Event[] = [];
    const ga = gatedTurns("a", gate, controller, {
      cap: "tasks",
      emit: (e) => emitted.push(e),
      startFailed: (message, options, err) => {
        startError = err instanceof Error ? err : new Error(String(err));
        return controller.send(message, options);
      },
    });
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await ga.send("one", { onEvent: (e) => seen.push(e) });
    await controller.flush();
    log.mockRestore();
    const failed: Event = { type: "done", ok: false, error: { code: "agent-crashed", detail: "Couldn't get ready for this turn" } };
    expect(seen).toEqual([failed]);
    expect(emitted).toEqual([failed]);
    expect(chat.map((e) => [e.role, e.text, e.error])).toEqual([
      ["user", "one", undefined],
      ["assistant", "", { code: "agent-crashed", detail: "Couldn't get ready for this turn" }],
    ]);
    expect(ga.isBusy()).toBe(false);
  });

  it("cancel of a running turn goes to the inner turns", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const a = fakeTurns();
    const ga = gatedTurns("a", gate, a, { cap: "tasks" });
    void ga.send("one", {});
    ga.cancel();
    expect(a.cancel).toHaveBeenCalledTimes(1);
  });

  it("frees the slot once when the inner send fails or throws", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const a = fakeTurns();
    const ga = gatedTurns("a", gate, a, { cap: "tasks" });
    const p = ga.send("one", {});
    a.pending[0].reject(new Error("A turn is already running"));
    await expect(p).rejects.toThrow("A turn is already running");
    expect(gate.running("tasks")).toBe(0);
    const throwing = { send: vi.fn(() => { throw new Error("boom"); }), isBusy: () => false, cancel: vi.fn() };
    await expect(gatedTurns("b", gate, throwing, { cap: "tasks" }).send("two", {})).rejects.toThrow("boom");
    expect(gate.running("tasks")).toBe(0);
  });

  it("a second send while the lane's turn waits is refused, as TurnController refuses one while running", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    void gatedTurns("a", gate, fakeTurns(), { cap: "tasks" }).send("one", {});
    const gb = gatedTurns("b", gate, fakeTurns(), { cap: "tasks" });
    void gb.send("two", {});
    await expect(gb.send("three", {})).rejects.toThrow("A turn is already running");
    expect(gate.queued("tasks").map((q) => q.text)).toEqual(["two"]);
  });

  it("an out-of-quota end pauses the queues with the reset of the window that ran out", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const a = fakeTurns();
    const ga = gatedTurns("a", gate, a, { cap: "tasks", now: () => Date.parse("2026-10-28T12:00:00Z") });
    const p = ga.send("one", {});
    const on = a.pending[0].options.onEvent!;
    on({
      type: "limits",
      status: "rejected",
      windows: [
        { kind: "seven_day", utilization: 0.4, resetsAt: "2026-11-02T00:00:00Z" },
        { kind: "five_hour", utilization: 1, resetsAt: "2026-10-28T15:00:00Z" },
      ],
    });
    on({ type: "done", ok: false, error: { code: "out-of-quota" } });
    a.pending[0].resolve();
    await p;
    expect(gate.paused()).toEqual({ reason: "out-of-quota", resetsAt: "2026-10-28T15:00:00Z" });
    gate.resume();
  });

  /** Runs one turn on lane `id` that reports `windows` (if any) and ends out of quota. */
  async function outOfQuotaTurn(gate: TurnGate, id: string, now: string, windows?: { kind: string; utilization: number; resetsAt: string }[]) {
    const t = fakeTurns();
    const p = gatedTurns(id, gate, t, { cap: "tasks", now: () => Date.parse(now) }).send("one", {});
    await flush();
    const on = t.pending[0].options.onEvent!;
    if (windows) on({ type: "limits", status: "rejected", windows });
    on({ type: "done", ok: false, error: { code: "out-of-quota" } });
    t.pending[0].resolve();
    await p;
  }

  it("a reset already past is no reset: the queues wait for the person's Resume", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    await outOfQuotaTurn(gate, "a", "2026-10-28T16:00:00Z", [{ kind: "five_hour", utilization: 1, resetsAt: "2026-10-28T15:00:00Z" }]);
    expect(gate.paused()).toEqual({ reason: "out-of-quota" });
    await flush();
    expect(gate.paused()).toEqual({ reason: "out-of-quota" });
  });

  it("an out-of-quota end never replaces a folder-move pause", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const t = fakeTurns();
    const p = gatedTurns("a", gate, t, { cap: "tasks", now: () => Date.parse("2026-10-28T12:00:00Z") }).send("one", {});
    gate.pause({ reason: "folder-move" });
    t.pending[0].options.onEvent!({ type: "limits", status: "rejected", windows: [{ kind: "five_hour", utilization: 1, resetsAt: "2026-10-28T12:00:01Z" }] });
    t.pending[0].options.onEvent!({ type: "done", ok: false, error: { code: "out-of-quota" } });
    t.pending[0].resolve();
    await p;
    expect(gate.paused()).toEqual({ reason: "folder-move" });
    await new Promise((r) => setTimeout(r, 20));
    expect(gate.paused()).toEqual({ reason: "folder-move" });
    gate.resume();
  });

  it("an out-of-quota end that knows no reset keeps another lane's pause and its reset", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const t = fakeTurns();
    const p = gatedTurns("c", gate, t, { cap: "tasks" }).send("one", {});
    // Another lane's turn ended out of quota while this one ran.
    gate.pause({ reason: "out-of-quota", resetsAt: "2099-10-28T15:00:00Z" });
    t.pending[0].options.onEvent!({ type: "done", ok: false, error: { code: "out-of-quota" } });
    t.pending[0].resolve();
    await p;
    expect(gate.paused()).toEqual({ reason: "out-of-quota", resetsAt: "2099-10-28T15:00:00Z" });
    gate.resume();
  });

  it("a second send while the lane's turn runs is refused before it reaches the gate", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const a = fakeTurns();
    const ga = gatedTurns("a", gate, a, { cap: "tasks" });
    void ga.send("one", {});
    expect(gate.running("tasks")).toBe(1);
    await expect(ga.send("two", {})).rejects.toThrow("A turn is already running");
    expect(gate.running("tasks")).toBe(1);
    expect(gate.queued("tasks")).toEqual([]);
    expect(a.send).toHaveBeenCalledTimes(1);
  });

  it("an out-of-quota end with no limits reported pauses until the person resumes", async () => {
    const gate = new TurnGate({ tasks: 2, jobs: 1 });
    const a = fakeTurns();
    const p = gatedTurns("a", gate, a, { cap: "tasks" }).send("one", {});
    a.pending[0].options.onEvent!({ type: "done", ok: false, error: { code: "out-of-quota" } });
    a.pending[0].resolve();
    await p;
    expect(gate.paused()).toEqual({ reason: "out-of-quota" });
  });

  it("forwards the caller's onEvent", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    const a = fakeTurns();
    const seen: Event[] = [];
    const p = gatedTurns("a", gate, a, { cap: "tasks" }).send("x", { onEvent: (e) => seen.push(e) });
    a.pending[0].options.onEvent!({ type: "text", delta: "hi" });
    a.pending[0].resolve();
    await p;
    expect(seen).toEqual([{ type: "text", delta: "hi" }]);
  });

  it("runs a lane's TurnController on its session slot (ensureRuntime: async () => slot)", async () => {
    const gate = new TurnGate({ tasks: 1, jobs: 1 });
    function lane(key: string) {
      const ends: (() => void)[] = [];
      const slot = {
        key,
        send: vi.fn((_m: string, emit: (e: Event) => void) => {
          let end!: () => void;
          const done = new Promise<void>((r) => (end = r));
          ends.push(() => {
            emit({ type: "done", ok: true });
            end();
          });
          return { cancel: () => undefined, done };
        }),
      } satisfies Pick<SessionSlot, "key" | "send">;
      const window: Event[] = [];
      const controller = new TurnController({
        ensureRuntime: async () => slot,
        chatLog: async () => ({ append: async () => undefined }),
        stateBlocks: () => new Set(),
        emit: (e) => window.push(e),
      });
      const turns = gatedTurns(key, gate, controller, { cap: "tasks", emit: (e) => window.push(e) });
      return { slot, ends, window, turns };
    }
    const a = lane("a");
    const b = lane("b");
    const pa = a.turns.send("one", {});
    const pb = b.turns.send("two", {});
    await flush();
    expect(a.slot.send).toHaveBeenCalledTimes(1);
    expect(b.slot.send).not.toHaveBeenCalled();
    a.ends[0]();
    await pa;
    await flush();
    expect(b.slot.send).toHaveBeenCalledTimes(1);
    b.ends[0]();
    await pb;
    expect(a.window).toEqual([{ type: "done", ok: true }]);
    expect(b.window).toEqual([{ type: "done", ok: true }]);
    expect(gate.running("tasks")).toBe(0);
  });
});
