// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState, LanguageState } from "../src/client";
import type { LanguageControl } from "../src/language-control";
import { type SettingsTab, SettingsSheet } from "../src/SettingsSheet";
import { ownName, systemLanguage } from "../src/language";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

function Sheet({
  client,
  initialTab = "general",
  onClose = () => {},
  onSetup = () => {},
  language,
}: {
  client: FakeClient;
  initialTab?: SettingsTab;
  onClose?: () => void;
  onSetup?: () => void;
  language?: LanguageControl;
}) {
  const [state, setState] = useState<AppState>(client.state);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return <SettingsSheet client={client} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={onClose} onSetup={onSetup} language={language} />;
}

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

describe("SettingsSheet", () => {
  it("is a dialog with General, Engine and Usage tabs; Done and Escape close it", async () => {
    const client = new FakeClient(ready);
    const onClose = vi.fn();
    await renderIn("en", <Sheet client={client} onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    expect(within(dialog).getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Usage"]);
    fireEvent.click(screen.getByRole("tab", { name: "Engine" }));
    expect(screen.getByRole("tab", { name: "Engine" }).getAttribute("aria-selected")).toBe("true");
    await screen.findByRole("group", { name: "AI engines" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    // Handled: a listener further out (focus mode's) leaves this Escape alone.
    expect(fireEvent.keyDown(document, { key: "Escape" })).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("adds a Models tab when the app sends its view", async () => {
    const client = new FakeClient(ready);
    client.state.models = {
      recommended: { questions: "standard" },
      defaults: { claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } } },
      offered: { claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low", "medium", "high", "xhigh", "max"] } },
      pinnedTokens: 3000,
    };
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Models", "Usage"]);
    fireEvent.click(screen.getByRole("tab", { name: "Models" }));
    expect(screen.getByRole("region", { name: "Tasks" })).toBeTruthy();
  });

  it("keeps Tab inside the sheet", async () => {
    await renderIn("en", <Sheet client={new FakeClient(ready)} />);
    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const focusable = [...dialog.querySelectorAll<HTMLElement>("button, a[href], input, textarea, select")];
    const [first, last] = [focusable[0], focusable.at(-1)!];
    last.focus();
    fireEvent.keyDown(last, { key: "Tab" });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(first, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("ignores Escape while a setup step is running", async () => {
    const client = new FakeClient(ready);
    client.status = { ...client.status, loggedIn: false };
    let finish!: () => void;
    client.setupGate = new Promise((r) => (finish = r));
    const onClose = vi.fn();
    await renderIn("en", <Sheet client={client} initialTab="engine" onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await screen.findByText(/Finish signing in using your browser/);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByText(/Finish signing in using your browser/)).toBeNull());
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open while a setup step runs, even on another tab, and shows the step again on return", async () => {
    const client = new FakeClient(ready);
    client.status = { ...client.status, loggedIn: false };
    let finish!: () => void;
    client.setupGate = new Promise((r) => (finish = r));
    const onClose = vi.fn();
    const { container } = await renderIn("en", <Sheet client={client} initialTab="engine" onClose={onClose} />);
    fireEvent.click(await screen.findByRole("button", { name: "Sign in" }));
    await screen.findByText(/Finish signing in using your browser/);
    act(() => client.emitSetup({ kind: "url", url: "https://claude.ai/oauth/authorize?x=1" }));
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(container.querySelector(".hh-sheet-backdrop")!);
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Engine" }));
    await screen.findByText(/Finish signing in using your browser/);
    expect(screen.getByRole("link", { name: "Open the sign-in page" }).getAttribute("href")).toBe("https://claude.ai/oauth/authorize?x=1");
    expect(screen.getByLabelText("If the page shows a code, paste it here")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(client.setupCancelled).toBe(1));
    await act(async () => finish());
    await screen.findByText("Claude is ready ✓");
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("says at sheet level what is running and why Done waits, with a Cancel, and keeps the engine tiles on it", async () => {
    const client = new FakeClient(ready);
    client.state.engines = [...client.state.engines, { ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI" }];
    client.statusFor.claude = { ...client.status, installed: false };
    let finish!: () => void;
    client.setupGate = new Promise((r) => (finish = r));
    await renderIn("en", <Sheet client={client} initialTab="engine" />);
    fireEvent.click(await screen.findByRole("button", { name: "Install" }));
    const line = await screen.findByText(/Installing Claude…/);
    expect(line.textContent).toBe("Installing Claude… Settings stays open until it finishes.");
    const done = screen.getByRole("button", { name: "Done" }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    expect(document.getElementById(done.getAttribute("aria-describedby")!)).toBe(line);
    expect((screen.getByRole("button", { name: /Codex/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("tab", { name: "General" }));
    expect(screen.getByText(/Installing Claude…/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(client.setupCancelled).toBe(1));
    await act(async () => finish());
    await waitFor(() => expect(screen.queryByText(/Installing Claude…/)).toBeNull());
    expect(done.disabled).toBe(false);
    expect(done.hasAttribute("aria-describedby")).toBe(false);
  });

  it("moves between tabs with the arrow keys; each tab controls its panel", async () => {
    await renderIn("en", <Sheet client={new FakeClient(ready)} />);
    const general = screen.getByRole("tab", { name: "General" });
    const panel = screen.getByRole("tabpanel");
    expect(general.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(general.id);
    general.focus();
    fireEvent.keyDown(general, { key: "ArrowRight" });
    const engine = screen.getByRole("tab", { name: "Engine" });
    expect(engine.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(engine);
    fireEvent.keyDown(engine, { key: "ArrowLeft" });
    fireEvent.keyDown(screen.getByRole("tab", { name: "General" }), { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Usage" }).getAttribute("aria-selected")).toBe("true");
    expect(general.getAttribute("tabindex")).toBe("-1");
  });

  it("opened while a step runs, puts focus on the tab instead of the disabled Done, and always offers Cancel", async () => {
    const client = new FakeClient(ready);
    client.running = { engineId: "claude", step: "login" };
    client.statusGates.claude = new Promise(() => {});
    await renderIn("en", <Sheet client={client} initialTab="engine" />);
    await screen.findByText(/Signing in to Claude…/);
    expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Engine" }));
    // The engine's status is still loading: the sheet's Cancel is the way out.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(client.setupCancelled).toBe(1));
  });

  it("General: changes appearance, shows the fixed folder and the About card", async () => {
    const client = new FakeClient(ready);
    await renderIn("en", <Sheet client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(client.state.config.appearance).toBe("dark"));
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    expect(screen.getByText("Don't move or rename it by hand: the app moves it for you, with its history.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    await waitFor(() => expect(client.revealed).toBe(1));
    expect(screen.getByText("Version 0.1.0")).toBeTruthy();
    expect(screen.getByText("Made by Marco Zanger with Human Harness")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Support" }).getAttribute("href")).toBe("https://example.com/donate");
  });

  it("shows the saved language by its own name, with the AI-thinks-in-English hint", async () => {
    const client = new FakeClient({ ...ready, language: "es" });
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getByText("Español")).toBeTruthy();
    expect(screen.getByText("The AI always thinks in English and writes to you in this language.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Language" })).toBeNull();
    expect(screen.queryByRole("button", { name: "English" })).toBeNull();
  });

  it("General: picks a text size, says which one is on and how to change it from the keyboard", async () => {
    const client = new FakeClient(ready);
    await renderIn("en", <Sheet client={client} />);
    const sizes = screen.getByRole("group", { name: "Text size" });
    expect(within(sizes).getAllByRole("button").map((b) => b.textContent)).toEqual(["AaNormal", "AaLarge", "AaLarger", "AaLargest"]);
    expect(within(sizes).getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe("true");
    expect(sizes.getAttribute("aria-describedby")).toBe(screen.getByText(/0 goes back to Normal\.$/).id);
    fireEvent.click(within(sizes).getByRole("button", { name: "Larger" }));
    await waitFor(() => expect(client.state.config.textSize).toBe("larger"));
    expect(within(sizes).getByRole("button", { name: "Larger" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(sizes).getByRole("button", { name: "Normal" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("General without a folder: only language, appearance, text size and About, no folder picker or welcome", async () => {
    const client = new FakeClient({});
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getByText("Language")).toBeTruthy();
    expect(screen.getByText(ownName(systemLanguage()))).toBeTruthy();
    expect(screen.getByRole("group", { name: "Appearance" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Text size" })).toBeTruthy();
    expect(screen.getByText("Version 0.1.0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose another folder" })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("Show in Finder")).toBeNull();
    expect(screen.queryByText(/works with an AI plan/)).toBeNull();
  });

  it.each(["engine", "models", "usage"] as const)("%s before setup: one empty state whose button opens the setup flow", async (tab) => {
    const client = new FakeClient({ language: "es", folder: "/Users/me/Documents/Demo" });
    client.state.models = {
      recommended: {},
      defaults: { claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } } },
      offered: { claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low"] } },
      pinnedTokens: 3000,
    };
    const onSetup = vi.fn();
    await renderIn("en", <Sheet client={client} initialTab={tab} onSetup={onSetup} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Models", "Usage"]);
    expect(screen.getByRole("heading", { name: "You haven't chosen an engine yet" })).toBeTruthy();
    expect(screen.getByText("First choose where your work is kept, then connect the AI. It takes two steps.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "AI engines" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Set up Demo" }));
    expect(onSetup).toHaveBeenCalledTimes(1);
  });

  it("D0: no harness tab when the harness declares no settings", async () => {
    await renderIn("en", <Sheet client={new FakeClient(ready)} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Engine", "Usage"]);
  });

  it("adds the harness's tab right after General, with its own name", async () => {
    const client = new FakeClient(ready);
    client.state.settings = {
      tab: "How I learn",
      sections: [],
      fields: [{ name: "tone", control: "segmented", label: "Tone", default: "patient", options: [{ value: "patient", label: "Patient" }], agent: true }],
    };
    client.settingsState = { values: { tone: "patient" }, pending: [] };
    await renderIn("en", <Sheet client={client} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "How I learn", "Engine", "Usage"]);
    fireEvent.click(screen.getByRole("tab", { name: "How I learn" }));
    const panel = screen.getByRole("tabpanel", { name: "How I learn" });
    expect(await within(panel).findByRole("group", { name: "Tone" })).toBeTruthy();
  });

  it("ArrowRight from General goes to the harness's tab", async () => {
    const client = new FakeClient(ready);
    client.state.settings = { tab: "How I learn", sections: [], fields: [] };
    await renderIn("en", <Sheet client={client} />);
    const general = screen.getByRole("tab", { name: "General" });
    general.focus();
    fireEvent.keyDown(general, { key: "ArrowRight" });
    const harness = screen.getByRole("tab", { name: "How I learn" });
    expect(harness.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(harness);
  });

  it("before the app is set up, the harness's tab leads to the setup flow", async () => {
    const client = new FakeClient({});
    client.state.settings = { tab: "How I learn", sections: [], fields: [] };
    await renderIn("en", <Sheet client={client} initialTab="harness" />);
    expect(screen.getByRole("heading", { name: "You haven't chosen an engine yet" })).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Tone" })).toBeNull();
  });

  it("Escape on a changed draft in the harness's tab drops the draft and keeps the sheet open", async () => {
    const client = new FakeClient(ready);
    client.state.settings = { tab: "How I learn", sections: [], fields: [{ name: "nickname", control: "text", label: "Nickname", default: "" }] };
    client.settingsState = { values: { nickname: "Ada" }, pending: [] };
    const onClose = vi.fn();
    await renderIn("en", <Sheet client={client} initialTab="harness" onClose={onClose} />);
    const input = await screen.findByLabelText<HTMLInputElement>("Nickname");
    await waitFor(() => expect(input.value).toBe("Ada"));
    fireEvent.change(input, { target: { value: "Grace" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    expect(input.value).toBe("Ada");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(client.settingsSets).toEqual([]);
  });
});

describe("Settings › General › Language (spec §3, §5, §6)", () => {
  const control = (view: Partial<LanguageState>) => ({
    view: { language: "es", cached: [], missing: 0, canTranslate: true as const, engineName: "Claude Code", run: null, ...view } as LanguageState,
    load: vi.fn(),
    choose: vi.fn(async () => "switched" as const),
    translate: vi.fn(async () => true),
    cancel: vi.fn(),
  });
  const renderSettings = (opts: { language?: LanguageControl; onClose?: () => void }) =>
    renderIn("en", <Sheet client={new FakeClient(ready)} language={opts.language} onClose={opts.onClose} />);

  it("shows the language by its own name and English name, with Change…; asks for the state once when shown", async () => {
    const c = control({ cached: [{ tag: "es", complete: true }] });
    await renderSettings({ language: c });
    expect(screen.getByText("Español").getAttribute("lang")).toBe("es");
    expect(screen.getByText("Spanish").getAttribute("lang")).toBe("en");
    expect(c.load).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    expect(screen.getByRole("dialog", { name: "Language" })).toBeTruthy();
  });

  it("Escape in the picker closes the picker, not the sheet", async () => {
    const onClose = vi.fn();
    await renderSettings({ language: control({ cached: [{ tag: "es", complete: true }] }), onClose });
    fireEvent.click(screen.getByRole("button", { name: "Change…" }));
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Language" }), { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Language" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Settings" })).toBeTruthy();
  });

  it("a running translation shows its progress and Cancel; Change… waits", async () => {
    const c = control({ run: { tag: "es", done: 3, total: 5, status: "running" } });
    await renderSettings({ language: c });
    expect(screen.getByText("Translating… 3 of 5").getAttribute("role")).toBe("status");
    expect((screen.getByRole("button", { name: "Change…" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(c.cancel).toHaveBeenCalled();
  });

  it("a stopped run offers Try again; new texts offer Translate; no engine disables them with the reason", async () => {
    await renderSettings({ language: control({ run: { tag: "es", done: 1, total: 5, status: "failed", reason: "quota" } }) });
    expect(screen.getByText("The translation stopped. What it finished is kept.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect((await screen.findByRole("alertdialog")).textContent).toContain("Español");
    cleanup();
    await renderSettings({ language: control({ cached: [{ tag: "es", complete: false }], missing: 4 }) });
    expect(screen.getByText("Some texts are new. Translate them?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Translate" }));
    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    cleanup();
    await renderSettings({ language: control({ missing: 800, canTranslate: "mock" }) });
    expect(screen.getByText("The app's texts aren't in Español yet.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Translate" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Connect an AI engine to translate the app.")).toBeTruthy();
    cleanup();
    await renderSettings({ language: control({ run: { tag: "es", done: 1, total: 5, status: "cancelled" }, canTranslate: "no-engine" }) });
    expect((screen.getByRole("button", { name: "Try again" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("English (and its variants) never offers a translation", async () => {
    await renderSettings({ language: control({ language: "en-GB", missing: 800 }) });
    expect(screen.queryByRole("button", { name: "Translate" })).toBeNull();
    expect(screen.getAllByText("British English")).toHaveLength(1);
  });

  it("D0: no language control keeps today's read-only row", async () => {
    await renderSettings({});
    expect(screen.queryByRole("button", { name: "Change…" })).toBeNull();
    expect(screen.getByText("The AI always thinks in English and writes to you in this language.")).toBeTruthy();
  });
});
