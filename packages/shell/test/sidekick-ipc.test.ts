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
    learned: async () => [{ id: "l-1", text: "Takes scope fixes.", level: "you", source: "learned" }],
    forget: async (id: unknown) => void calls.push(["forget", id]),
    forgetAll: async () => void calls.push(["forgetAll"]),
    editLearned: async (changes: unknown) => void calls.push(["editLearned", changes]),
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

  it("What Sidekick learned: list, forget, forget everything and edits pass through", async () => {
    const w = wire();
    expect(await w.call("hh:sidekickLearned")).toEqual([{ id: "l-1", text: "Takes scope fixes.", level: "you", source: "learned" }]);
    await w.call("hh:sidekickForget", "l-1");
    await w.call("hh:sidekickForgetAll");
    await w.call("hh:sidekickEditLearned", [{ id: "l-1", text: "Usually takes scope fixes." }]);
    expect(w.calls).toEqual([["forget", "l-1"], ["forgetAll"], ["editLearned", [{ id: "l-1", text: "Usually takes scope fixes." }]]]);
  });

  it("What Sidekick learned: malformed requests are ignored; without a controller, nothing learned", async () => {
    const w = wire();
    await w.call("hh:sidekickForget", 7);
    await w.call("hh:sidekickForget", "x".repeat(81));
    await w.call("hh:sidekickEditLearned", "l-1");
    await w.call("hh:sidekickEditLearned", { id: "l-1", text: "x" });
    await w.call("hh:sidekickEditLearned", [{ id: "l-1", text: "" }]);
    await w.call("hh:sidekickEditLearned", [{ id: "l-1", text: "   " }]);
    await w.call("hh:sidekickEditLearned", [{ id: "l-1", text: "x".repeat(301) }]);
    await w.call("hh:sidekickEditLearned", [{ id: 1, text: "fine" }]);
    await w.call("hh:sidekickEditLearned", [{ id: "l-1", text: "fine" }, null]);
    await w.call("hh:sidekickEditLearned", Array.from({ length: 51 }, (_, i) => ({ id: `l-${i}`, text: "fine" })));
    expect(w.calls).toEqual([]);
    const off = wire(false);
    expect(await off.call("hh:sidekickLearned")).toEqual([]);
    await off.call("hh:sidekickForget", "l-1");
    await off.call("hh:sidekickForgetAll");
    await off.call("hh:sidekickEditLearned", [{ id: "l-1", text: "fine" }]);
    expect(off.calls).toEqual([]);
  });
});

describe("sidekick IPC: before approve", () => {
  function approveWire(available = true) {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const calls: unknown[][] = [];
    const ctl = {
      beforeApprove: async (doc: unknown) => (calls.push(["beforeApprove", doc]), { kind: "card", card: { id: "c1" } }),
      cancelApprove: () => void calls.push(["cancelApprove"]),
    };
    registerSidekickIpc(
      (ch, fn) => void handlers.set(ch, fn),
      () => (available ? (ctl as never) : null),
    );
    const call = (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
    return { call, calls };
  }

  it("hh:sidekickBeforeApprove passes a valid document through", async () => {
    const w = approveWire();
    expect(await w.call("hh:sidekickBeforeApprove", { title: "Spec", text: "# Spec", extra: 1 })).toEqual({ kind: "card", card: { id: "c1" } });
    await w.call("hh:sidekickApproveCancel");
    expect(w.calls).toEqual([["beforeApprove", { title: "Spec", text: "# Spec" }], ["cancelApprove"]]);
  });

  it("hh:sidekickBeforeApprove ignores bad input", async () => {
    const w = approveWire();
    for (const bad of [{ title: 1, text: "x" }, { title: "x" }, { title: "x".repeat(201), text: "x" }, { title: "x", text: "x".repeat(200_001) }, { title: "x", text: "   " }, null, "doc"]) {
      expect(await w.call("hh:sidekickBeforeApprove", bad)).toEqual({ kind: "approve" });
    }
    expect(w.calls).toEqual([]);
    expect(await approveWire(false).call("hh:sidekickBeforeApprove", { title: "x", text: "y" })).toEqual({ kind: "approve" });
    await approveWire(false).call("hh:sidekickApproveCancel");
  });
});

describe("sidekick IPC: places", () => {
  function askWire(available = true) {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const calls: unknown[][] = [];
    const ctl = { ask: async (place: unknown, content: unknown) => (calls.push([place, content]), { ok: true, text: "Busy port.", speaker: { id: "watch", name: "Watch", mark: "👀" } }) };
    registerSidekickIpc(
      (ch, fn) => void handlers.set(ch, fn),
      () => (available ? (ctl as never) : null),
    );
    const call = (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
    return { call, calls };
  }

  it("hh:sidekickAsk passes a valid place and text through", async () => {
    const w = askWire();
    expect(await w.call("hh:sidekickAsk", "terminal", "EADDRINUSE")).toEqual({ ok: true, text: "Busy port.", speaker: { id: "watch", name: "Watch", mark: "👀" } });
    expect(await w.call("hh:sidekickAsk", "t", "x".repeat(4000))).toMatchObject({ ok: true });
    expect(w.calls).toEqual([["terminal", "EADDRINUSE"], ["t", "x".repeat(4000)]]);
  });

  it("hh:sidekickAsk answers not ok to bad input, without reaching the controller", async () => {
    const w = askWire();
    const bad: unknown[][] = [
      ["Terminal", "x"],
      ["1term", "x"],
      ["t".repeat(65), "x"],
      ["__proto__", "x"],
      [7, "x"],
      ["terminal", ""],
      ["terminal", "   "],
      ["terminal", "x".repeat(4001)],
      ["terminal", { text: "x" }],
      ["terminal"],
    ];
    for (const args of bad) expect(await w.call("hh:sidekickAsk", ...args)).toEqual({ ok: false });
    expect(w.calls).toEqual([]);
    expect(await askWire(false).call("hh:sidekickAsk", "terminal", "x")).toEqual({ ok: false });
  });

  it("a controller failure is not ok", async () => {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    registerSidekickIpc((ch, fn) => void handlers.set(ch, fn), () => ({ ask: async () => Promise.reject(new Error("boom")) }) as never);
    expect(await (handlers.get("hh:sidekickAsk") as (...a: unknown[]) => unknown)("terminal", "x")).toEqual({ ok: false });
  });
});

describe("sidekick IPC: presets", () => {
  function presetWire(ctl: object | null) {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    registerSidekickIpc(
      (ch, fn) => void handlers.set(ch, fn),
      () => ctl as never,
    );
    return (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
  }
  const GUARD = { name: "Guard", mark: "🛡️", personality: "", purposes: [{ id: "process-guard" }], adopted: false };

  it("lists the presets ([] without a controller or on a failure); adopts a bounded name only", async () => {
    const calls: unknown[] = [];
    const call = presetWire({ presets: async () => [GUARD], adoptPreset: async (n: unknown) => void calls.push(n) });
    expect(await call("hh:sidekickPresets")).toEqual([GUARD]);
    await call("hh:sidekickAdoptPreset", "Guard");
    for (const bad of ["", "x".repeat(41), 7, null, { name: "Guard" }]) await call("hh:sidekickAdoptPreset", bad);
    expect(calls).toEqual(["Guard"]);
    expect(await presetWire(null)("hh:sidekickPresets")).toEqual([]);
    expect(await presetWire({ presets: async () => Promise.reject(new Error("boom")) })("hh:sidekickPresets")).toEqual([]);
  });
});
