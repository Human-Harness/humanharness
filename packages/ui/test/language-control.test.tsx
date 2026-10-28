// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "@humanharness/i18n";
import { applyLanguage, useLanguage } from "../src/language-control";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

describe("useLanguage", () => {
  it("asks for nothing until a screen needs the state (no engine check at start)", async () => {
    const client = new FakeClient();
    const i18n = await createI18n("en");
    const { result } = renderHook(() => useLanguage(client, i18n, {}, () => {}));
    await act(async () => {});
    expect(client.languageCalls).toEqual([]);
    expect(result.current.view).toBeNull();
    act(() => result.current.load());
    await waitFor(() => expect(result.current.view).not.toBeNull());
    expect(client.languageCalls.map((c) => c.op)).toEqual(["state"]);
  });

  it("chooses a complete language: loads its strings and switches live", async () => {
    const client = new FakeClient();
    client.languageState = { ...client.languageState, cached: [{ tag: "es", complete: true }] };
    client.languageStrings.es = { "core:chat.send": "Enviar" };
    const i18n = await createI18n("en");
    const changed: string[] = [];
    const { result } = renderHook(() => useLanguage(client, i18n, { title: "Notes" }, (tag) => changed.push(tag)));
    act(() => result.current.load());
    await waitFor(() => expect(result.current.view).not.toBeNull());
    await act(async () => expect(await result.current.choose("es")).toBe("switched"));
    expect(i18n.language).toBe("es");
    expect(i18n.t("chat.send")).toBe("Enviar");
    expect(changed).toEqual(["es"]);
    expect(result.current.view?.language).toBe("es");
    expect(client.languageCalls.find((c) => c.op === "choose")!.args).toEqual(["es", { title: "Notes" }]);
  });

  it("an incomplete language needs the notice; a run's end switches", async () => {
    const client = new FakeClient();
    client.languageStrings.fr = { "core:chat.send": "Envoyer" };
    const i18n = await createI18n("en");
    const changed: string[] = [];
    const { result } = renderHook(() => useLanguage(client, i18n, {}, (tag) => changed.push(tag)));
    await act(async () => expect(await result.current.choose("fr")).toBe("needs-translation"));
    await act(async () => expect(await result.current.translate("fr")).toBe(true));
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 0, total: 1, status: "running" } }));
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 1, total: 1, status: "done" } }));
    await waitFor(() => expect(i18n.t("chat.send")).toBe("Envoyer"));
    expect(result.current.view?.language).toBe("fr");
    expect(changed).toEqual(["fr"]);
  });

  it("a run's end loads the strings even when i18next already names the saved language (no cache at start)", async () => {
    const client = new FakeClient();
    client.languageStrings.es = { "core:chat.send": "Enviar" };
    // A saved "es" with no cache starts as lng "es" on English resources.
    const i18n = await createI18n("es");
    const changed: string[] = [];
    renderHook(() => useLanguage(client, i18n, {}, (tag) => changed.push(tag)));
    // A finished run seen without its running part (an old state) loads nothing.
    await act(async () => client.pushLanguage({ language: "es", run: { tag: "es", done: 1, total: 1, status: "done" } }));
    expect(client.languageCalls.filter((c) => c.op === "strings")).toEqual([]);
    await act(async () => client.pushLanguage({ language: "es", run: { tag: "es", done: 0, total: 1, status: "running" } }));
    await act(async () => client.pushLanguage({ language: "es", run: { tag: "es", done: 1, total: 1, status: "done" } }));
    await waitFor(() => expect(i18n.t("chat.send")).toBe("Enviar"));
    expect(i18n.resolvedLanguage).toBe("es");
    expect(changed).toEqual(["es"]);
  });

  it("a translate answered failed (e.g. cancelled while preparing) means nothing started", async () => {
    const client = new FakeClient();
    client.translateAnswer = { ok: false, reason: "failed" };
    const i18n = await createI18n("en");
    const { result } = renderHook(() => useLanguage(client, i18n, {}, () => {}));
    await act(async () => expect(await result.current.translate("fr")).toBe(false));
  });

  it("re-choosing a language replaces its old strings, it doesn't merge them", async () => {
    const client = new FakeClient();
    client.languageState = { ...client.languageState, cached: [{ tag: "es", complete: true }] };
    client.languageStrings.es = { "core:chat.send": "Enviar", "core:chat.stop": "Parar" };
    const i18n = await createI18n("en");
    const english = i18n.t("chat.stop");
    const { result } = renderHook(() => useLanguage(client, i18n, {}, () => {}));
    await act(async () => void (await result.current.choose("es")));
    client.languageStrings.es = { "core:chat.send": "Mandar" };
    await act(async () => void (await result.current.choose("es")));
    expect(i18n.t("chat.send")).toBe("Mandar");
    expect(i18n.t("chat.stop")).toBe(english);
  });

  it("an English variant never takes generated strings", async () => {
    const client = new FakeClient();
    client.chooseAnswer = { ok: true, language: "en-GB", strings: { "core:chat.send": "Hacked" } };
    const i18n = await createI18n("en");
    const { result } = renderHook(() => useLanguage(client, i18n, {}, () => {}));
    await act(async () => expect(await result.current.choose("en-GB")).toBe("switched"));
    expect(i18n.language).toBe("en-GB");
    expect(i18n.t("chat.send")).toBe("Send");
    expect(i18n.hasResourceBundle("en-GB", "core")).toBe(false);
  });

  it("drops a run's late strings once the language changed again", async () => {
    const client = new FakeClient();
    client.languageStrings.fr = { "core:chat.send": "Envoyer" };
    let open!: () => void;
    client.languageGate = new Promise<void>((r) => (open = r));
    const i18n = await createI18n("en");
    const changed: string[] = [];
    const { result } = renderHook(() => useLanguage(client, i18n, {}, (tag) => changed.push(tag)));
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 0, total: 1, status: "running" } }));
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 1, total: 1, status: "done" } }));
    await act(async () => expect(await result.current.choose("en")).toBe("switched"));
    await act(async () => open());
    await act(async () => {});
    expect(i18n.language).toBe("en");
    expect(i18n.t("chat.send")).toBe("Send");
    expect(changed).toEqual(["en"]);
  });

  it("drops a late state answer when a push came after it was asked", async () => {
    const client = new FakeClient();
    let open!: () => void;
    client.languageGate = new Promise<void>((r) => (open = r));
    const i18n = await createI18n("en");
    const { result } = renderHook(() => useLanguage(client, i18n, {}, () => {}));
    act(() => result.current.load());
    await act(async () => client.pushLanguage({ missing: 7 }));
    await act(async () => open());
    await act(async () => {});
    expect(result.current.view?.missing).toBe(7);
  });

  it("an empty or legal-only set for a non-English tag doesn't switch (dates would change, texts stay English)", async () => {
    const sets: Record<string, string>[] = [{}, { "core:legal.engine.accept": "Acepto" }];
    for (const strings of sets) {
      const client = new FakeClient();
      client.chooseAnswer = { ok: true, language: "es", strings };
      const i18n = await createI18n("en");
      const changed: string[] = [];
      const { result, unmount } = renderHook(() => useLanguage(client, i18n, {}, (tag) => changed.push(tag)));
      await act(async () => expect(await result.current.choose("es")).toBe("failed"));
      expect(i18n.language).toBe("en");
      expect(i18n.hasResourceBundle("es", "core")).toBe(false);
      expect(changed).toEqual([]);
      unmount();
    }
  });

  it("applyLanguage refuses an empty non-English set and still switches back to English", async () => {
    const i18n = await createI18n("en");
    expect(await applyLanguage(i18n, "es", {})).toBe(false);
    expect(i18n.language).toBe("en");
    expect(await applyLanguage(i18n, "es", { "core:chat.send": "Enviar" })).toBe(true);
    expect(i18n.language).toBe("es");
    expect(await applyLanguage(i18n, "en", {})).toBe(true);
    expect(i18n.language).toBe("en");
  });

  it("a strings() rejection at a run's end switches nothing", async () => {
    const client = new FakeClient();
    client.language = { ...client.language, strings: () => Promise.reject(new Error("ipc")) };
    const i18n = await createI18n("en");
    const changed: string[] = [];
    renderHook(() => useLanguage(client, i18n, {}, (tag) => changed.push(tag)));
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 0, total: 1, status: "running" } }));
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 1, total: 1, status: "done" } }));
    await act(async () => {});
    expect(i18n.language).toBe("en");
    expect(changed).toEqual([]);
  });

  it("an unmount drops a pending switch", async () => {
    const client = new FakeClient();
    client.languageStrings.fr = { "core:chat.send": "Envoyer" };
    let open!: () => void;
    client.languageGate = new Promise<void>((r) => (open = r));
    const i18n = await createI18n("en");
    const changed: string[] = [];
    const { unmount } = renderHook(() => useLanguage(client, i18n, {}, (tag) => changed.push(tag)));
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 0, total: 1, status: "running" } }));
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 1, total: 1, status: "done" } }));
    expect(client.languageCalls.filter((c) => c.op === "strings")).toHaveLength(1);
    unmount();
    await act(async () => open());
    await act(async () => {});
    expect(i18n.language).toBe("en");
    expect(changed).toEqual([]);
  });

  it("a resubscribe keeps the running flag, so the run's end still switches", async () => {
    const client = new FakeClient();
    client.languageStrings.fr = { "core:chat.send": "Envoyer" };
    const first = await createI18n("en");
    const second = await createI18n("en");
    const { rerender } = renderHook(({ i18n }) => useLanguage(client, i18n, {}, () => {}), { initialProps: { i18n: first } });
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 0, total: 1, status: "running" } }));
    rerender({ i18n: second });
    await act(async () => client.pushLanguage({ language: "fr", run: { tag: "fr", done: 1, total: 1, status: "done" } }));
    await waitFor(() => expect(second.t("chat.send")).toBe("Envoyer"));
  });

  it("without client.language: no view and nothing to do (D0)", async () => {
    const client = new FakeClient();
    (client as { language?: unknown }).language = undefined;
    const i18n = await createI18n("en");
    const { result } = renderHook(() => useLanguage(client, i18n, {}, () => {}));
    act(() => result.current.load());
    expect(result.current.view).toBeNull();
    expect(await result.current.choose("es")).toBe("failed");
    expect(await result.current.translate("es")).toBe(false);
    expect(i18n.language).toBe("en");
  });
});
