import { describe, expect, it, vi } from "vitest";
import { languageClient } from "../src/preload/language";

describe("client.language in the preload", () => {
  it("passes channels and arguments; a rejected invoke or a non-data answer is the fallback, never a throw", async () => {
    const invoke = vi.fn(async (channel: string, ..._args: unknown[]) => (channel === "hh:languageTranslate" ? { ok: true } : undefined));
    const c = languageClient(invoke, () => () => {});
    expect(await c.translate("es", { a: "b" })).toEqual({ ok: true });
    expect(invoke).toHaveBeenCalledWith("hh:languageTranslate", "es", { a: "b" });
    expect(await c.state({})).toBeNull();
    expect(await c.choose("es", {})).toEqual({ ok: false, reason: "failed" });
    expect(await c.strings("es", {})).toEqual({});
    expect(await c.cancel()).toEqual({ ok: false });
    const rejecting = languageClient(async () => Promise.reject(new Error("no handler")), () => () => {});
    expect(await rejecting.cancel()).toEqual({ ok: false });
    expect(await rejecting.translate("es", {})).toEqual({ ok: false, reason: "failed" });
    expect(await rejecting.choose("es", {})).toEqual({ ok: false, reason: "failed" });
    expect(await rejecting.state({})).toBeNull();
    expect(await rejecting.strings("es", {})).toEqual({});
  });

  it("strings keeps only string values, and so do the strings of a chosen language", async () => {
    const c = languageClient(async () => ({ "core:a": "x", "core:b": 3 }), () => () => {});
    expect(await c.strings("es", {})).toEqual({ "core:a": "x" });
    const chosen = languageClient(async () => ({ ok: true, language: "es", strings: { "core:a": "x", "core:b": {} } }), () => () => {});
    expect(await chosen.choose("es", {})).toEqual({ ok: true, language: "es", strings: { "core:a": "x" } });
    const noStrings = languageClient(async () => ({ ok: true, language: "es" }), () => () => {});
    expect(await noStrings.choose("es", {})).toEqual({ ok: true, language: "es", strings: {} });
  });

  it("state answers only a well-formed state", async () => {
    const good = { language: "es", cached: [], missing: 0, canTranslate: true, run: null };
    expect(await languageClient(async () => good, () => () => {}).state({})).toEqual(good);
    expect(await languageClient(async () => ({ ...good, run: "x" }), () => () => {}).state({})).toBeNull();
    expect(await languageClient(async () => ({ ...good, missing: "1" }), () => () => {}).state({})).toBeNull();
  });

  it("onChange hears only well-formed states and returns the unsubscribe", () => {
    let push: (v: unknown) => void = () => {};
    const off = vi.fn();
    const subscribe = vi.fn((_ch: string, l: (v: unknown) => void) => ((push = l), off));
    const c = languageClient(async () => null, subscribe);
    const got: unknown[] = [];
    const unsubscribe = c.onChange((s) => got.push(s));
    expect(subscribe).toHaveBeenCalledWith("hh:language", expect.any(Function));
    push(null);
    push({ language: 3 });
    push({ language: "es", cached: [], missing: 0, canTranslate: true, run: null });
    expect(got).toHaveLength(1);
    unsubscribe();
    expect(off).toHaveBeenCalledOnce();
  });
});
