// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, EngineProblem, EngineStatus, LanguageState } from "../src/client";
import { Home, languageOffer } from "../src/Home";
import type { LanguageControl } from "../src/language-control";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const configured = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

async function renderHome(
  client: FakeClient,
  {
    status = null as EngineStatus | null,
    checkFailed = false,
    language = undefined as LanguageControl | undefined,
    onChange = (() => {}) as (state: AppState) => void,
  } = {},
) {
  const onStart = vi.fn();
  const onSetup = vi.fn();
  await renderIn(
    "en",
    <Home
      state={client.state}
      client={client}
      onChange={onChange}
      status={status}
      checkFailed={checkFailed}
      limits={null}
      onStart={onStart}
      onSetup={onSetup}
      onSettings={() => {}}
      onEngine={() => {}}
      {...(language ? { language } : {})}
    />,
  );
  return { onStart, onSetup };
}

describe("Home", () => {
  it("ready: Start opens the work screen, with no missing card", async () => {
    const client = new FakeClient(configured);
    const { onStart, onSetup } = await renderHome(client, { status: client.status });
    fireEvent.click(screen.getByRole("button", { name: "Start Demo" }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(onSetup).not.toHaveBeenCalled();
    expect(document.querySelector(".hh-missing")).toBeNull();
  });

  it("checking: Start is shown but disabled, and the pill says Checking", async () => {
    const client = new FakeClient(configured);
    await renderHome(client);
    expect((screen.getByRole("button", { name: "Start Demo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Claude.*Checking…/ })).toBeTruthy();
    expect(document.querySelector(".hh-missing")).toBeNull();
  });

  it("first launch: lists both steps and Set up opens the setup flow", async () => {
    const client = new FakeClient();
    const { onStart, onSetup } = await renderHome(client);
    const items = screen.getByRole("region", { name: "Two steps before you start" }).querySelectorAll("li");
    expect([...items].map((li) => li.textContent)).toEqual(["1Choose where your work is kept", "2Connect the AI engine"]);
    expect(items[0].querySelector("svg")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start Demo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up Demo" }));
    expect(onSetup).toHaveBeenCalledOnce();
    expect(onStart).not.toHaveBeenCalled();
  });

  it("first launch with the folder saved: the folder step shows a check", async () => {
    const client = new FakeClient({ folder: "/Users/me/Documents/Demo" });
    await renderHome(client);
    const items = screen.getByRole("region", { name: "Two steps before you start" }).querySelectorAll("li");
    expect(items[0].textContent).toBe("Choose where your work is kept");
    expect(items[0].querySelector("svg")).toBeTruthy();
    expect(items[1].textContent).toBe("2Connect the AI engine");
    expect(screen.getByRole("button", { name: "Set up Demo" })).toBeTruthy();
  });

  const problems: [Partial<EngineStatus>, EngineProblem, string][] = [
    [{ noticeAccepted: false }, "notice", "accept Claude's notice"],
    [{ installed: false }, "not-installed", "install Claude"],
    [{ outdated: true }, "outdated", "update Claude"],
    [{ loggedIn: false }, "logged-out", "sign in to Claude again"],
    [{ verified: false }, "untested", "test Claude"],
  ];
  for (const [change, problem, step] of problems) {
    it(`configured with the engine ${problem}: one step left, and Set up`, async () => {
      const client = new FakeClient({ ...configured });
      const { onSetup } = await renderHome(client, { status: { ...client.status, ...change } });
      expect(screen.getByText(`One step left: ${step}`)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Set up Demo" }));
      expect(onSetup).toHaveBeenCalledOnce();
    });
  }

  it("a failed engine check asks to check the engine", async () => {
    const client = new FakeClient(configured);
    await renderHome(client, { checkFailed: true });
    expect(screen.getByText("One step left: check Claude")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Set up Demo" })).toBeTruthy();
  });

  it("draws a generic screen on the pill for an engine without a logo", async () => {
    const client = new FakeClient(configured);
    client.state.engines = [{ ...client.state.engines[0], name: "Simulated AI (mock)", logo: undefined, mock: true }];
    await renderHome(client, { status: client.status });
    const pill = screen.getByRole("button", { name: /Simulated AI \(mock\)/ });
    expect(pill.querySelector("img")).toBeNull();
    expect(pill.querySelector("svg")).toBeTruthy();
  });
});

describe("the language offer (spec §3, §10)", () => {
  const view: LanguageState = { language: "en", cached: [], missing: 0, canTranslate: true, run: null };
  const spanish = { ...configured, language: "es" };
  it("suggests a non-English saved language without a translation, else the system language; never English (D0)", () => {
    expect(languageOffer({ config: spanish }, { ...view, language: "es", missing: 9 }, true, "en")).toBe("es");
    expect(languageOffer({ config: configured }, view, true, "fr")).toBe("fr");
    expect(languageOffer({ config: configured }, view, true, "en")).toBeNull();
    expect(languageOffer({ config: configured }, view, true, "en-GB")).toBeNull();
    expect(languageOffer({ config: configured }, view, true, "he")).toBeNull();
    // A complete saved language: nothing to offer, and the system language doesn't take its place.
    expect(languageOffer({ config: spanish }, { ...view, language: "es" }, true, "fr")).toBeNull();
  });
  it("not before the engine is ready, not in mock mode, not once answered, not during a run or over a started translation", () => {
    expect(languageOffer({ config: configured }, view, false, "fr")).toBeNull();
    expect(languageOffer({ config: configured }, view, null, "fr")).toBeNull();
    expect(languageOffer({ config: configured, mock: true }, view, true, "fr")).toBeNull();
    expect(languageOffer({ config: { ...configured, languageOffered: true } }, view, true, "fr")).toBeNull();
    expect(languageOffer({ config: { folder: "/f" } }, view, true, "fr")).toBeNull();
    expect(languageOffer({ config: configured }, null, true, "fr")).toBeNull();
    const run = { tag: "fr", done: 1, total: 9, status: "running" as const };
    expect(languageOffer({ config: configured }, { ...view, run }, true, "fr")).toBeNull();
    // A started (partial) translation of the saved language is Settings' "finish translating", not this card.
    const partial = { ...view, language: "es", missing: 9, cached: [{ tag: "es", complete: false }] };
    expect(languageOffer({ config: spanish }, partial, true, "en")).toBeNull();
  });
});

describe("the language offer card", () => {
  const spanish: LanguageState = { language: "es", cached: [], missing: 9, canTranslate: true, engineName: "Claude Code", run: null };
  const control = (view: LanguageState | null): LanguageControl => ({ view, load: vi.fn(), choose: vi.fn(), translate: vi.fn(), cancel: vi.fn() });
  const title = "Use Demo in another language?";

  it("Choose language opens the picker with the suggestion; the offer is saved as answered", async () => {
    const client = new FakeClient({ ...configured, language: "es" });
    const language = control(spanish);
    await renderHome(client, { status: client.status, language });
    const card = screen.getByRole("region", { name: title });
    expect(card.textContent).toContain("Suggested: Español");
    expect(card.querySelector('[lang="es"]')?.textContent).toBe("Español");
    fireEvent.click(screen.getByRole("button", { name: "Choose language" }));
    expect(screen.getByRole("dialog", { name: "Language" })).toBeTruthy();
    expect((screen.getByRole("radio", { name: /Español/ }) as HTMLInputElement).checked).toBe(true);
    expect(screen.queryByRole("region", { name: title })).toBeNull();
    await waitFor(() => expect(client.state.config.languageOffered).toBe(true));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Start Demo" }));
  });

  it("Not now hides it for good", async () => {
    const client = new FakeClient({ ...configured, language: "es" });
    const onChange = vi.fn();
    await renderHome(client, { status: client.status, language: control(spanish), onChange });
    screen.getByRole("button", { name: "Not now" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.queryByRole("region", { name: title })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(client.state.config.languageOffered).toBe(true));
    expect(onChange).toHaveBeenCalledWith(client.state);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Start Demo" }));
  });

  it("asks for the state only with a non-English suggestion (D0: an English person and system ask nothing)", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("en-US");
    const english = control(null);
    const en = new FakeClient(configured);
    await renderHome(en, { status: en.status, language: english });
    expect(english.load).not.toHaveBeenCalled();
    expect(document.querySelector(".hh-langoffer")).toBeNull();
    cleanup();

    const answered = control(null);
    const done = new FakeClient({ ...configured, language: "es", languageOffered: true });
    await renderHome(done, { status: done.status, language: answered });
    expect(answered.load).not.toHaveBeenCalled();
    cleanup();

    const notReady = control(null);
    const es = new FakeClient({ ...configured, language: "es" });
    await renderHome(es, { language: notReady });
    expect(notReady.load).not.toHaveBeenCalled();
    cleanup();

    const wants = control(null);
    await renderHome(es, { status: es.status, language: wants });
    expect(wants.load).toHaveBeenCalledOnce();
    // Until the state comes, no card.
    expect(document.querySelector(".hh-langoffer")).toBeNull();
  });

  it("a French system asks for the state; a right-to-left system language asks nothing and shows nothing", async () => {
    const system = vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
    const asks = control(null);
    const client = new FakeClient(configured);
    await renderHome(client, { status: client.status, language: asks });
    expect(asks.load).toHaveBeenCalledOnce();
    cleanup();

    system.mockReturnValue("he");
    const rtl = control({ ...spanish, language: "en", missing: 0 });
    await renderHome(client, { status: client.status, language: rtl });
    expect(rtl.load).not.toHaveBeenCalled();
    expect(document.querySelector(".hh-langoffer")).toBeNull();
  });

  it("mock mode: no card and no ask", async () => {
    const client = new FakeClient({ ...configured, language: "es" });
    client.state.mock = true;
    const language = control(spanish);
    await renderHome(client, { status: client.status, language });
    expect(language.load).not.toHaveBeenCalled();
    expect(document.querySelector(".hh-langoffer")).toBeNull();
  });

  it("a connected engine is not enough: with Set up still showing (no active profile) there is no card and no ask", async () => {
    const client = new FakeClient({ ...configured, language: "es" });
    client.state = { ...client.state, profiles: { label: "student", form: { fields: [] } } };
    const language = control(spanish);
    await renderHome(client, { status: client.status, language });
    expect(screen.queryByRole("button", { name: "Start Demo" })).toBeNull();
    expect(language.load).not.toHaveBeenCalled();
    expect(document.querySelector(".hh-langoffer")).toBeNull();
  });
});
