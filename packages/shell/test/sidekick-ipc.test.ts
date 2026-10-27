import { describe, expect, it } from "vitest";
import { registerSidekickIpc } from "../src/main/sidekick-ipc";

function wire(available = true) {
  const handlers = new Map<string, (...args: never[]) => unknown>();
  const calls: unknown[][] = [];
  const ctl = {
    state: async () => ({ status: "off" }),
    set: async (p: unknown) => (calls.push(["set", p]), { ok: true }),
    review: async (r: unknown) => (calls.push(["review", r]), { kind: "card" }),
    cancel: () => void calls.push(["cancel"]),
    resolve: async (id: unknown, o: unknown) => void calls.push(["resolve", id, o]),
    mute: async (id: unknown) => void calls.push(["mute", id]),
    unmute: async (s: unknown, k: unknown) => void calls.push(["unmute", s, k]),
    saveDecision: async (id: unknown) => (calls.push(["saveDecision", id]), { ok: true }),
  };
  registerSidekickIpc(
    (ch, fn) => void handlers.set(ch, fn),
    () => (available ? (ctl as never) : null),
  );
  const call = (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
  return { call, calls };
}

describe("sidekick IPC", () => {
  it("passes valid requests through", async () => {
    const w = wire();
    expect(await w.call("hh:sidekickGet")).toEqual({ status: "off" });
    await w.call("hh:sidekickSet", { on: true });
    expect(await w.call("hh:sidekickReview", { text: "make it better", force: true })).toEqual({ kind: "card" });
    await w.call("hh:sidekickReview", { text: "see the file", attached: true, force: "yes" });
    await w.call("hh:sidekickCancel");
    await w.call("hh:sidekickResolve", "c1", "used");
    await w.call("hh:sidekickMute", "c1");
    await w.call("hh:sidekickUnmute", "sidekick", "vague");
    expect(w.calls).toEqual([
      ["set", { on: true }],
      ["review", { text: "make it better", force: true }],
      ["review", { text: "see the file", attached: true }],
      ["cancel"],
      ["resolve", "c1", "used"],
      ["mute", "c1"],
      ["unmute", "sidekick", "vague"],
    ]);
  });

  it("refuses malformed requests", async () => {
    const w = wire();
    expect(await w.call("hh:sidekickSet", "on")).toMatchObject({ ok: false });
    expect(await w.call("hh:sidekickSet", [true])).toMatchObject({ ok: false });
    expect(await w.call("hh:sidekickReview", { text: 3 })).toEqual({ kind: "send" });
    expect(await w.call("hh:sidekickReview", { text: "   " })).toEqual({ kind: "send" });
    expect(await w.call("hh:sidekickReview", null)).toEqual({ kind: "send" });
    expect(await w.call("hh:sidekickReview", { text: "x".repeat(20_001) })).toEqual({ kind: "send" });
    await w.call("hh:sidekickResolve", "c1", "nope");
    await w.call("hh:sidekickResolve", 7, "used");
    await w.call("hh:sidekickMute", 7);
    await w.call("hh:sidekickMute", "x".repeat(81));
    await w.call("hh:sidekickUnmute", "sidekick");
    await w.call("hh:sidekickUnmute", "", "vague");
    expect(w.calls).toEqual([]);
  });

  it("without a controller: no state, refusals, and a review sends as typed", async () => {
    const w = wire(false);
    expect(await w.call("hh:sidekickGet")).toBeNull();
    expect(await w.call("hh:sidekickSet", { on: true })).toMatchObject({ ok: false });
    expect(await w.call("hh:sidekickReview", { text: "make it better" })).toEqual({ kind: "send" });
    await w.call("hh:sidekickCancel");
    await w.call("hh:sidekickResolve", "c1", "used");
    await w.call("hh:sidekickMute", "c1");
    await w.call("hh:sidekickUnmute", "sidekick", "vague");
  });

  it("Save as decision: a valid card id reaches the controller; anything else is refused as data", async () => {
    const w = wire();
    expect(await w.call("hh:sidekickSaveDecision", "c1")).toEqual({ ok: true });
    expect(await w.call("hh:sidekickSaveDecision", 42)).toMatchObject({ ok: false });
    expect(await w.call("hh:sidekickSaveDecision", "x".repeat(81))).toMatchObject({ ok: false });
    expect(w.calls).toEqual([["saveDecision", "c1"]]);
    expect(await wire(false).call("hh:sidekickSaveDecision", "c1")).toMatchObject({ ok: false });
  });
});
