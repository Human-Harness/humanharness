import { describe, expect, it } from "vitest";
import { registerSidekickIpc } from "../src/ipc";
import { SIDEKICK_MAX } from "../src/store";

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
    expect(await w.call("get")).toEqual({ status: "off" });
    await w.call("set", { on: true });
    expect(await w.call("review", { text: "make it better", force: true })).toEqual({ kind: "card" });
    await w.call("review", { text: "see the file", attached: true, force: "yes" });
    await w.call("review", { text: "my answer", block: true });
    await w.call("review", { text: "my answer", block: "yes" });
    await w.call("cancelReview");
    await w.call("resolve", "c1", "used");
    await w.call("mute", "c1");
    await w.call("unmute", "sidekick", "vague");
    expect(w.calls).toEqual([
      ["set", { on: true }],
      ["review", { text: "make it better", force: true }],
      ["review", { text: "see the file", attached: true }],
      ["review", { text: "my answer", block: true }],
      ["review", { text: "my answer" }],
      ["cancel"],
      ["resolve", "c1", "used"],
      ["mute", "c1"],
      ["unmute", "sidekick", "vague"],
    ]);
  });

  it("refuses malformed requests", async () => {
    const w = wire();
    expect(await w.call("set", "on")).toMatchObject({ ok: false });
    expect(await w.call("set", [true])).toMatchObject({ ok: false });
    expect(await w.call("review", { text: 3 })).toEqual({ kind: "send" });
    expect(await w.call("review", { text: "   " })).toEqual({ kind: "send" });
    expect(await w.call("review", null)).toEqual({ kind: "send" });
    expect(await w.call("review", { text: "x".repeat(20_001) })).toEqual({ kind: "send" });
    await w.call("resolve", "c1", "nope");
    await w.call("resolve", 7, "used");
    await w.call("mute", 7);
    await w.call("mute", "x".repeat(81));
    await w.call("unmute", "sidekick");
    await w.call("unmute", "", "vague");
    expect(w.calls).toEqual([]);
  });

  it("without a controller: no state, refusals, and a review sends as typed", async () => {
    const w = wire(false);
    expect(await w.call("get")).toBeNull();
    expect(await w.call("set", { on: true })).toMatchObject({ ok: false });
    expect(await w.call("review", { text: "make it better" })).toEqual({ kind: "send" });
    await w.call("cancelReview");
    await w.call("resolve", "c1", "used");
    await w.call("mute", "c1");
    await w.call("unmute", "sidekick", "vague");
  });

  it("Save as decision: a valid card id reaches the controller; anything else is refused as data", async () => {
    const w = wire();
    expect(await w.call("saveDecision", "c1")).toEqual({ ok: true });
    expect(await w.call("saveDecision", 42)).toMatchObject({ ok: false });
    expect(await w.call("saveDecision", "x".repeat(81))).toMatchObject({ ok: false });
    expect(w.calls).toEqual([["saveDecision", "c1"]]);
    expect(await wire(false).call("saveDecision", "c1")).toMatchObject({ ok: false });
  });

  it("What Sidekick learned: list, forget, forget everything and edits pass through", async () => {
    const w = wire();
    expect(await w.call("learned")).toEqual([{ id: "l-1", text: "Takes scope fixes.", level: "you", source: "learned" }]);
    await w.call("forget", "l-1");
    await w.call("forgetAll");
    await w.call("editLearned", [{ id: "l-1", text: "Usually takes scope fixes." }]);
    expect(w.calls).toEqual([["forget", "l-1"], ["forgetAll"], ["editLearned", [{ id: "l-1", text: "Usually takes scope fixes." }]]]);
  });

  it("What Sidekick learned: malformed requests are ignored; without a controller, nothing learned", async () => {
    const w = wire();
    await w.call("forget", 7);
    await w.call("forget", "x".repeat(81));
    await w.call("editLearned", "l-1");
    await w.call("editLearned", { id: "l-1", text: "x" });
    await w.call("editLearned", [{ id: "l-1", text: "" }]);
    await w.call("editLearned", [{ id: "l-1", text: "   " }]);
    await w.call("editLearned", [{ id: "l-1", text: "x".repeat(301) }]);
    await w.call("editLearned", [{ id: 1, text: "fine" }]);
    await w.call("editLearned", [{ id: "l-1", text: "fine" }, null]);
    await w.call("editLearned", Array.from({ length: 51 }, (_, i) => ({ id: `l-${i}`, text: "fine" })));
    expect(w.calls).toEqual([]);
    const off = wire(false);
    expect(await off.call("learned")).toEqual([]);
    await off.call("forget", "l-1");
    await off.call("forgetAll");
    await off.call("editLearned", [{ id: "l-1", text: "fine" }]);
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

  it("beforeApprove passes a valid document through", async () => {
    const w = approveWire();
    expect(await w.call("beforeApprove", { title: "Spec", text: "# Spec", extra: 1 })).toEqual({ kind: "card", card: { id: "c1" } });
    await w.call("cancelApprove");
    expect(w.calls).toEqual([["beforeApprove", { title: "Spec", text: "# Spec" }], ["cancelApprove"]]);
  });

  it("beforeApprove ignores bad input", async () => {
    const w = approveWire();
    for (const bad of [{ title: 1, text: "x" }, { title: "x" }, { title: "x".repeat(201), text: "x" }, { title: "x", text: "x".repeat(200_001) }, { title: "x", text: "   " }, null, "doc"]) {
      expect(await w.call("beforeApprove", bad)).toEqual({ kind: "approve" });
    }
    expect(w.calls).toEqual([]);
    expect(await approveWire(false).call("beforeApprove", { title: "x", text: "y" })).toEqual({ kind: "approve" });
    await approveWire(false).call("cancelApprove");
  });
});

describe("sidekick IPC: places", () => {
  function askWire(available = true) {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const calls: unknown[][] = [];
    const ctl = { ask: async (place: unknown, content: unknown) => (calls.push([place, content]), { ok: true, text: "Busy port.", speaker: { id: "watch", name: "Watch", mark: "focus" } }) };
    registerSidekickIpc(
      (ch, fn) => void handlers.set(ch, fn),
      () => (available ? (ctl as never) : null),
    );
    const call = (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
    return { call, calls };
  }

  it("ask passes a valid place and text through", async () => {
    const w = askWire();
    expect(await w.call("ask", "terminal", "EADDRINUSE")).toEqual({ ok: true, text: "Busy port.", speaker: { id: "watch", name: "Watch", mark: "focus" } });
    expect(await w.call("ask", "t", "x".repeat(4000))).toMatchObject({ ok: true });
    expect(w.calls).toEqual([["terminal", "EADDRINUSE"], ["t", "x".repeat(4000)]]);
  });

  it("ask answers not ok to bad input, without reaching the controller", async () => {
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
    for (const args of bad) expect(await w.call("ask", ...args)).toEqual({ ok: false });
    expect(w.calls).toEqual([]);
    expect(await askWire(false).call("ask", "terminal", "x")).toEqual({ ok: false });
  });

  it("a controller failure is not ok", async () => {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    registerSidekickIpc((ch, fn) => void handlers.set(ch, fn), () => ({ ask: async () => Promise.reject(new Error("boom")) }) as never);
    expect(await (handlers.get("ask") as (...a: unknown[]) => unknown)("terminal", "x")).toEqual({ ok: false });
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
  const GUARD = { name: "Guard", mark: "guardian", personality: "", purposes: [{ id: "process-guard" }], adopted: false };

  it("lists the presets ([] without a controller or on a failure); adopts a bounded name only", async () => {
    const calls: unknown[] = [];
    const call = presetWire({ presets: async () => [GUARD], adoptPreset: async (n: unknown) => void calls.push(n) });
    expect(await call("presets")).toEqual([GUARD]);
    await call("adoptPreset", "Guard");
    for (const bad of ["", "x".repeat(41), 7, null, { name: "Guard" }]) await call("adoptPreset", bad);
    expect(calls).toEqual(["Guard"]);
    expect(await presetWire(null)("presets")).toEqual([]);
    expect(await presetWire({ presets: async () => Promise.reject(new Error("boom")) })("presets")).toEqual([]);
  });
});

describe("sidekick IPC: saveSidekick", () => {
  function saveWire(count = 1) {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const calls: unknown[][] = [];
    const ctl = {
      saveSidekick: async (def: unknown, learned: unknown) => (calls.push([def, learned]), { id: "rulo", name: "Rulo", mark: "mentor" }),
      list: async () => Array.from({ length: count }, (_, i) => ({ id: `k${i}` })),
    };
    registerSidekickIpc(
      (ch, fn) => void handlers.set(ch, fn),
      () => ctl as never,
    );
    return { call: (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args), calls };
  }
  const DEF = { name: "Rulo", mark: "mentor", personality: "Direct.", purposes: [{ id: "mentor" }], source: { kind: "paste" } };

  it("passes a valid def (only a sidekick's fields) and bounded learned items", async () => {
    const w = saveWire();
    expect(await w.call("saveSidekick", { ...DEF, id: "rulo", tier: "light", defaultOn: false, order: 3, on: true, text: "x" }, [{ text: " Short answers. ", level: "you" }])).toEqual({ id: "rulo", name: "Rulo", mark: "mentor" });
    await w.call("saveSidekick", DEF);
    expect(w.calls).toEqual([
      [{ ...DEF, id: "rulo", tier: "light", defaultOn: false }, [{ text: "Short answers.", level: "you" }]],
      [DEF, []],
    ]);
  });

  it("refuses a malformed def or learned list before the controller", async () => {
    const w = saveWire();
    const bad: unknown[][] = [
      [null],
      [{ ...DEF, name: "" }],
      [{ ...DEF, purposes: [] }],
      [{ ...DEF, purposes: [{ id: "boss" }] }],
      [{ ...DEF, source: { kind: "files", paths: ["/n/a.md"], hash: "nope" } }],
      [{ ...DEF, id: "x".repeat(81) }],
      [{ ...DEF, id: "settings" }],
      [DEF, "x"],
      [DEF, [{ text: "", level: "you" }]],
      [DEF, [{ text: "x", level: "boss" }]],
      [DEF, Array.from({ length: 51 }, () => ({ text: "x", level: "you" }))],
    ];
    for (const args of bad) await expect(w.call("saveSidekick", ...args)).rejects.toThrow();
    expect(w.calls).toEqual([]);
  });
});

describe("sidekick IPC: the list, remove and reorder (Settings › Sidekicks)", () => {
  function listWire(ctl: Record<string, unknown> | null) {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    registerSidekickIpc(
      (ch, fn) => void handlers.set(ch, fn),
      () => ctl as never,
    );
    return (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
  }

  it("passes valid requests through; the store's refusal comes back as its message", async () => {
    const calls: unknown[][] = [];
    const call = listWire({
      list: async () => [{ id: "sidekick", name: "Sidekick", mark: "coach", personality: "", purposes: [{ id: "prompt-coach" }], order: 0 }],
      removeSidekick: async (id: string) => {
        calls.push(["remove", id]);
        if (id === "sidekick") throw new Error("Keep at least one sidekick");
      },
      reorder: async (ids: unknown) => void calls.push(["reorder", ids]),
    });
    expect(await call("list")).toHaveLength(1);
    expect(await call("remove", "rulo")).toEqual({ ok: true });
    expect(await call("remove", "sidekick")).toEqual({ ok: false, message: "Keep at least one sidekick" });
    await call("reorder", ["rulo", "sidekick"]);
    expect(calls).toEqual([["remove", "rulo"], ["remove", "sidekick"], ["reorder", ["rulo", "sidekick"]]]);
  });

  it("refuses malformed requests; a reorder names at most SIDEKICK_MAX ids", async () => {
    const calls: unknown[][] = [];
    const call = listWire({ removeSidekick: async (id: unknown) => void calls.push(["remove", id]), reorder: async (ids: unknown) => void calls.push(["reorder", ids]), list: async () => Promise.reject(new Error("boom")) });
    expect(await call("remove", 7)).toMatchObject({ ok: false });
    expect(await call("remove", "x".repeat(81))).toMatchObject({ ok: false });
    for (const bad of [null, "rulo", [], [7], ["x".repeat(81)], Array.from({ length: SIDEKICK_MAX + 1 }, (_, i) => `k${i}`)]) await call("reorder", bad);
    expect(calls).toEqual([]);
    expect(await call("list")).toEqual([]);
    expect(await listWire(null)("list")).toEqual([]);
    expect(await listWire(null)("remove", "rulo")).toMatchObject({ ok: false });
  });
});

describe("sidekick IPC: sidekicks in a scope (spec §2a.4)", () => {
  function scopeWire(ctl: Record<string, unknown> | null) {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    registerSidekickIpc(
      (ch, fn) => void handlers.set(ch, fn),
      () => ctl as never,
    );
    return (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args);
  }
  const ROW = { id: "rulo", name: "Rulo", mark: "mentor", on: true };

  it("passes valid requests through; the store's refusal comes back as its message", async () => {
    const calls: unknown[][] = [];
    const call = scopeWire({
      scopeSidekicks: async (scope: string) => (calls.push(["scope", scope]), [ROW]),
      setScope: async (scope: string, sidekick: string, v: unknown) => {
        calls.push(["setScope", scope, sidekick, v]);
        if (sidekick === "ghost") throw new Error('No sidekick "ghost"');
      },
    });
    expect(await call("scope", "login")).toEqual([ROW]);
    expect(await call("setScope", "login", "rulo", { on: false, purposeText: "x".repeat(600), places: ["terminal"], extra: 1 })).toEqual({ ok: true });
    expect(await call("setScope", "login", "rulo", { on: true, purposeText: "  " })).toEqual({ ok: true });
    expect(await call("setScope", "login", "ghost", { on: true })).toEqual({ ok: false, message: 'No sidekick "ghost"' });
    expect(calls).toEqual([
      ["scope", "login"],
      ["setScope", "login", "rulo", { on: false, purposeText: "x".repeat(600), places: ["terminal"] }],
      ["setScope", "login", "rulo", { on: true }],
      ["setScope", "login", "ghost", { on: true }],
    ]);
  });

  it("refuses malformed requests: scope id, sidekick id, text past 600, places", async () => {
    const calls: unknown[][] = [];
    const call = scopeWire({ scopeSidekicks: async () => Promise.reject(new Error("boom")), setScope: async (...a: unknown[]) => void calls.push(a) });
    for (const scope of ["Login", "../x", "", 7, "x".repeat(65)]) {
      expect(await call("scope", scope)).toEqual([]);
      expect(await call("setScope", scope, "rulo", { on: true })).toMatchObject({ ok: false });
    }
    for (const bad of [
      ["login", 7, { on: true }],
      ["login", "x".repeat(81), { on: true }],
      ["login", "rulo", null],
      ["login", "rulo", []],
      ["login", "rulo", {}],
      ["login", "rulo", { on: "yes" }],
      ["login", "rulo", { on: true, purposeText: "x".repeat(601) }],
      ["login", "rulo", { on: true, purposeText: 7 }],
      ["login", "rulo", { on: true, places: ["Bad Id"] }],
      ["login", "rulo", { on: true, places: Array.from({ length: 13 }, (_, i) => `p${i}`) }],
    ]) expect(await call("setScope", ...bad)).toMatchObject({ ok: false });
    expect(calls).toEqual([]);
    expect(await call("scope", "login")).toEqual([]);
    expect(await scopeWire(null)("scope", "login")).toEqual([]);
    expect(await scopeWire(null)("setScope", "login", "rulo", { on: true })).toMatchObject({ ok: false });
  });
});

describe("sidekick IPC: import", () => {
  const TOKEN = "a1".repeat(16);
  function importWire(available = true) {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const calls: unknown[][] = [];
    const ctl = {
      pickFiles: async () => (calls.push(["pickFiles"]), { token: TOKEN, files: ["a.md"] }),
      importDraft: async (input: unknown) => (calls.push(["importDraft", input]), { ok: false, reason: "empty" }),
      checkSidekick: async (id: unknown) => (calls.push(["checkSidekick", id]), "changed"),
    };
    registerSidekickIpc(
      (ch, fn) => void handlers.set(ch, fn),
      () => (available ? (ctl as never) : null),
    );
    return { call: (ch: string, ...args: unknown[]) => (handlers.get(ch) as (...a: unknown[]) => unknown)(...args), calls };
  }

  it("passes valid requests through", async () => {
    const w = importWire();
    expect(await w.call("pickFiles")).toEqual({ token: TOKEN, files: ["a.md"] });
    expect(await w.call("importDraft", { kind: "paste", text: "You are Rulo." })).toEqual({ ok: false, reason: "empty" });
    await w.call("importDraft", { kind: "paste", text: "x".repeat(64 * 1024), extra: 1 });
    await w.call("importDraft", { kind: "files", token: TOKEN, paths: ["/etc/hosts"] });
    await w.call("importDraft", { kind: "original", sidekickId: "rulo" });
    expect(await w.call("checkOriginal", "rulo")).toBe("changed");
    expect(w.calls).toEqual([
      ["pickFiles"],
      ["importDraft", { kind: "paste", text: "You are Rulo." }],
      ["importDraft", { kind: "paste", text: "x".repeat(64 * 1024) }],
      ["importDraft", { kind: "files", token: TOKEN }],
      ["importDraft", { kind: "original", sidekickId: "rulo" }],
      ["checkSidekick", "rulo"],
    ]);
  });

  it("refuses malformed input before the controller", async () => {
    const w = importWire();
    const bad: unknown[] = [
      null,
      "text",
      { kind: "paste" },
      { kind: "paste", text: 7 },
      { kind: "paste", text: "x".repeat(64 * 1024 + 1) },
      // Raw paths never reach the controller: only a pick's token names files.
      { kind: "files", paths: ["/n/a.md"] },
      { kind: "files", paths: ["/Users/x/.ssh/id_ed25519"] },
      { kind: "files", token: "" },
      { kind: "files", token: "A1".repeat(16) },
      { kind: "files", token: "a1".repeat(17) },
      { kind: "files", token: ["a1".repeat(16)] },
      { kind: "original" },
      { kind: "original", sidekickId: "x".repeat(81) },
      { kind: "other", text: "x" },
    ];
    for (const b of bad) expect(await w.call("importDraft", b)).toEqual({ ok: false, reason: "failed" });
    for (const b of ["", 7, "x".repeat(81), null]) expect(await w.call("checkOriginal", b)).toBe("none");
    expect(w.calls).toEqual([]);
    const off = importWire(false);
    expect(await off.call("pickFiles")).toBeNull();
    expect(await off.call("importDraft", { kind: "paste", text: "x" })).toEqual({ ok: false, reason: "failed" });
    expect(await off.call("checkOriginal", "rulo")).toBe("none");
  });

  it("a controller failure is a failed import, no files, or none", async () => {
    const handlers = new Map<string, (...args: never[]) => unknown>();
    const boom = async () => Promise.reject(new Error("boom"));
    registerSidekickIpc((ch, fn) => void handlers.set(ch, fn), () => ({ pickFiles: boom, importDraft: boom, checkSidekick: boom }) as never);
    const call = (ch: string, ...a: unknown[]) => (handlers.get(ch) as (...x: unknown[]) => unknown)(...a);
    expect(await call("pickFiles")).toBeNull();
    expect(await call("importDraft", { kind: "paste", text: "x" })).toEqual({ ok: false, reason: "failed" });
    expect(await call("checkOriginal", "rulo")).toBe("none");
  });
});
