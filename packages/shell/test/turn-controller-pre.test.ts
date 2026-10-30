import { describe, expect, it, vi } from "vitest";
import type { Event, HarnessRuntime, ToolCallView } from "@humanharness/runtime";
import type { ChatEntry } from "@humanharness/ui";
import { TurnController, type TurnDeps } from "../src/main/turn-controller";

type Emit = (e: Event) => void;

/** A runtime whose turn ends when the test calls `finish`. */
function fakeRuntime() {
  let emit: Emit = () => {};
  let end!: () => void;
  const send = vi.fn((_m: string, e: Emit, _options?: unknown) => {
    emit = e;
    return { cancel: () => {}, done: new Promise<void>((res) => (end = res)) };
  });
  return {
    runtime: { send, history: {}, close: async () => {} } as unknown as HarnessRuntime,
    send,
    finish(events: Event[]) {
      for (const e of events) emit(e);
      end();
    },
  };
}

function setup(ensureRuntime: TurnDeps["ensureRuntime"]) {
  const order: string[] = [];
  const entries: ChatEntry[] = [];
  const events: Event[] = [];
  const controller = new TurnController({
    ensureRuntime,
    chatLog: async () => ({
      append: async (e) => {
        entries.push(e);
        order.push(`log:${e.role}`);
      },
    }),
    stateBlocks: () => new Set(),
    emit: (e) => {
      order.push(`emit:${e.type}`);
      events.push(e);
    },
  });
  return { controller, order, entries, events };
}

const view = (tool: string, extra: Partial<ToolCallView> = {}): ToolCallView => ({
  tool,
  caller: "pre",
  ok: true,
  ms: 300,
  summary: "3 items",
  args: "{}",
  accesses: [],
  at: "2026-10-29T10:00:00.000Z",
  ...extra,
});
const prepared = [view("due-today"), view("due-today", { note: "today: cut: 12 of 40 items", ms: 0 })];
const agentCall = view("pr-ci", { caller: "agent" });

describe("prepared calls on the first turn (tools spec §8.2)", () => {
  it("D0: a turn without prepared emits what it emitted", async () => {
    for (const options of [{ task: "t1" }, { task: "t1", prepared: [] }]) {
      const fake = fakeRuntime();
      const { controller, order, entries, events } = setup(async () => fake.runtime);
      const sent = controller.send("hi", options);
      await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
      fake.finish([{ type: "text", delta: "Hello" }, { type: "done", ok: true }]);
      await sent;
      expect(order).toEqual(["log:user", "emit:text", "log:assistant", "emit:done"]);
      expect(events).toEqual([{ type: "text", delta: "Hello" }, { type: "done", ok: true }]);
      expect(entries[1]).not.toHaveProperty("tools");
    }
  });

  it("the views arrive as tool-call events after the user entry and before any engine event", async () => {
    const fake = fakeRuntime();
    const { controller, order, events } = setup(async () => fake.runtime);
    const sent = controller.send("hi", { task: "t1", prepared });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    // Shown before the engine says anything.
    expect(events).toEqual(prepared.map((call) => ({ type: "tool-call", call })));
    fake.finish([{ type: "text", delta: "Hello" }, { type: "done", ok: true }]);
    await sent;
    // The user entry is queued for the log first; the window gets the calls before anything the engine says.
    expect(order.filter((o) => o.startsWith("emit:"))).toEqual(["emit:tool-call", "emit:tool-call", "emit:text", "emit:done"]);
    expect(order.filter((o) => o.startsWith("log:"))).toEqual(["log:user", "log:assistant"]);
  });

  it("they are saved on the turn's assistant entry in the chat log, first in its tools", async () => {
    const fake = fakeRuntime();
    const { controller, entries } = setup(async () => fake.runtime);
    const sent = controller.send("hi", { task: "t1", prepared });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    expect(controller.addToTurn("t1", { type: "tool-call", call: agentCall })).toBe(true);
    fake.finish([{ type: "text", delta: "Hello" }, { type: "done", ok: true }]);
    await sent;
    expect(entries[1]!.tools).toEqual([...prepared, agentCall]);
  });

  it("a held first attempt (model-unavailable fallback) shows them once, with the retry", async () => {
    const first = fakeRuntime();
    const { controller, entries, events } = setup(async () => first.runtime);
    const held = controller.send("hi", { task: "t1", prepared, holdModelError: true });
    await vi.waitFor(() => expect(first.send).toHaveBeenCalled());
    // Held: nothing reaches the window while the attempt may still fail.
    expect(events).toEqual([]);
    first.finish([{ type: "done", ok: false, error: { code: "model-unavailable" } }]);
    await held;
    expect(events).toEqual([]);
    expect(entries.map((e) => e.role)).toEqual(["user"]);

    const retry = fakeRuntime();
    const { controller: again, entries: saved, events: shown } = setup(async () => retry.runtime);
    const sent = again.send("hi", { task: "t1", prepared, skipUserEntry: true });
    await vi.waitFor(() => expect(retry.send).toHaveBeenCalled());
    retry.finish([{ type: "text", delta: "Hello" }, { type: "done", ok: true }]);
    await sent;
    expect(shown.filter((e) => e.type === "tool-call")).toEqual(prepared.map((call) => ({ type: "tool-call", call })));
    expect(saved.map((e) => e.role)).toEqual(["assistant"]);
    expect(saved[0]!.tools).toEqual(prepared);
  });

  it("a held attempt whose model answers shows them once, first, at its first content", async () => {
    const fake = fakeRuntime();
    const { controller, events, entries } = setup(async () => fake.runtime);
    const sent = controller.send("hi", { task: "t1", prepared, holdModelError: true });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([
      { type: "limits", status: "allowed", windows: [] },
      { type: "text", delta: "Hello" },
      { type: "done", ok: true },
    ]);
    await sent;
    expect(events.map((e) => e.type)).toEqual(["tool-call", "tool-call", "limits", "text", "done"]);
    expect(entries[1]!.tools).toEqual(prepared);
  });

  it("a quiet turn shows and saves none of them", async () => {
    const fake = fakeRuntime();
    const { controller, events, entries } = setup(async () => fake.runtime);
    const sent = controller.send("hi", { task: "t1", prepared, quiet: true });
    await vi.waitFor(() => expect(fake.send).toHaveBeenCalled());
    fake.finish([{ type: "text", delta: "Hello" }, { type: "done", ok: true }]);
    await sent;
    expect(events).toEqual([]);
    expect(entries).toEqual([]);
  });

  it("a turn whose engine can't start still shows and saves them, before its error", async () => {
    const { controller, entries, events } = setup(async () => null);
    await controller.send("hi", { task: "t1", prepared });
    expect(events.map((e) => e.type)).toEqual(["tool-call", "tool-call", "done"]);
    expect(events.slice(0, 2)).toEqual(prepared.map((call) => ({ type: "tool-call", call })));
    expect(entries.map((e) => e.role)).toEqual(["user", "assistant"]);
    expect(entries[1]!.tools).toEqual(prepared);
  });

  it("a held attempt (model fallback) whose engine can't start shows them with its error", async () => {
    const { controller, entries, events } = setup(async () => null);
    await controller.send("hi", { task: "t1", prepared, holdModelError: true });
    expect(events.map((e) => e.type)).toEqual(["tool-call", "tool-call", "done"]);
    expect(entries[1]!.tools).toEqual(prepared);
  });
});
