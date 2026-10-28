import { describe, expect, it } from "vitest";
import { LANGUAGE_CHANNELS, languageHandlers } from "../src/main/language-ipc";

function recorder() {
  const calls: unknown[][] = [];
  const svc = {
    state: async (h: unknown) => (calls.push(["state", h]), { language: "en" }),
    choose: async (t: unknown, h: unknown) => (calls.push(["choose", t, h]), { ok: true }),
    translate: async (t: unknown, h: unknown) => (calls.push(["translate", t, h]), { ok: true }),
    cancel: async () => (calls.push(["cancel"]), { ok: true }),
    strings: async (t: unknown, h: unknown) => (calls.push(["strings", t, h]), { core: {} }),
  };
  return { calls, h: languageHandlers(svc as never) };
}

describe("hh:language* (language spec)", () => {
  it("passes the arguments and answers data; a throw is logged and answered as data", async () => {
    const calls: unknown[][] = [];
    const svc = {
      state: async (h: unknown) => (calls.push(["state", h]), { language: "en" }),
      choose: async () => {
        throw new Error("boom");
      },
      translate: async (t: unknown, h: unknown) => (calls.push(["translate", t, h]), { ok: true }),
      cancel: async () => ({ ok: true }),
      strings: async () => {
        throw new Error("boom");
      },
    };
    const h = languageHandlers(svc as never);
    expect(Object.keys(h).sort()).toEqual([...LANGUAGE_CHANNELS].sort());
    expect(await h["hh:languageState"]({ a: "b" })).toEqual({ language: "en" });
    expect(await h["hh:languageTranslate"]("es", {})).toEqual({ ok: true });
    expect(await h["hh:languageChoose"]("es", {})).toEqual({ ok: false, reason: "failed" });
    expect(await h["hh:languageStrings"]("es", {})).toEqual({});
    expect(calls).toEqual([["state", { a: "b" }], ["translate", "es", {}]]);
  });

  it("refuses a tag the app can't offer before asking the service", async () => {
    const { calls, h } = recorder();
    for (const bad of [42, null, "EN", "x".repeat(36), "ar", "he-IL", "not a tag", { tag: "es" }]) {
      expect(await h["hh:languageChoose"](bad, {})).toEqual({ ok: false, reason: "invalid" });
      expect(await h["hh:languageTranslate"](bad, {})).toEqual({ ok: false, reason: "invalid" });
      expect(await h["hh:languageStrings"](bad, {})).toEqual({});
    }
    expect(calls).toEqual([]);
  });

  it("passes only a plain object as the harness map: anything else is an empty one", async () => {
    const { calls, h } = recorder();
    await h["hh:languageState"]("nope");
    await h["hh:languageState"](["a"]);
    await h["hh:languageState"](null);
    await h["hh:languageChoose"]("pt-BR", 7);
    await h["hh:languageStrings"]("de", { x: "y" });
    await h["hh:languageCancel"]("ignored");
    expect(calls).toEqual([
      ["state", {}],
      ["state", {}],
      ["state", {}],
      ["choose", "pt-BR", {}],
      ["strings", "de", { x: "y" }],
      ["cancel"],
    ]);
  });

  it("answers the fallback when a call throws synchronously, and cancel's fallback is not ok", async () => {
    const boom = () => {
      throw new Error("sync");
    };
    const h = languageHandlers({ state: boom, choose: boom, translate: boom, cancel: boom, strings: boom } as never);
    expect(await h["hh:languageState"]({})).toBeNull();
    expect(await h["hh:languageTranslate"]("es", {})).toEqual({ ok: false, reason: "failed" });
    expect(await h["hh:languageCancel"]()).toEqual({ ok: false });
  });
});
