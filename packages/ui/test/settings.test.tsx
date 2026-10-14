// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppState } from "../src/client";
import { type SettingsTab, SettingsSheet } from "../src/SettingsSheet";
import { formatReset } from "../src/usage";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

function Sheet({
  client,
  initialTab = "general",
  onClose = () => {},
  onSetup = () => {},
}: {
  client: FakeClient;
  initialTab?: SettingsTab;
  onClose?: () => void;
  onSetup?: () => void;
}) {
  const [state, setState] = useState<AppState>(client.state);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return <SettingsSheet client={client} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={onClose} onSetup={onSetup} />;
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
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("adds a Models tab when the app sends its view", async () => {
    const client = new FakeClient(ready);
    client.state.models = {
      recommended: { questions: "standard" },
      defaults: { claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } } },
      offered: { claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low", "medium", "high", "xhigh", "max"] } },
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

  it("General: changes language and appearance, shows the fixed folder and the About card", async () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    await screen.findByRole("tab", { name: "Motor" });
    expect(client.state.config.language).toBe("es");
  });

  it("General without a folder: only language, appearance and About, no folder picker or welcome", async () => {
    const client = new FakeClient({});
    await renderIn("es", <Sheet client={client} />);
    expect(screen.getByRole("group", { name: "Idioma" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Apariencia" })).toBeTruthy();
    expect(screen.getByText("Versión 0.1.0")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Usar esta carpeta" })).toBeNull();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("Mostrar en Finder")).toBeNull();
    expect(screen.queryByText(/funciona con un plan de IA/)).toBeNull();
  });

  it.each(["engine", "models", "usage"] as const)("%s before setup: one empty state whose button opens the setup flow", async (tab) => {
    const client = new FakeClient({ language: "es", folder: "/Users/me/Documents/Demo" });
    client.state.models = {
      recommended: {},
      defaults: { claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } } },
      offered: { claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low"] } },
    };
    const onSetup = vi.fn();
    await renderIn("es", <Sheet client={client} initialTab={tab} onSetup={onSetup} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["General", "Motor", "Modelos", "Uso"]);
    expect(screen.getByRole("heading", { name: "Todavía no elegiste un motor" })).toBeTruthy();
    expect(screen.getByText("Primero elegí dónde se guarda tu trabajo y después conectá la IA. Son dos pasos.")).toBeTruthy();
    expect(screen.queryByRole("group", { name: "Motores de IA" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Configurar Demo" }));
    expect(onSetup).toHaveBeenCalledTimes(1);
  });

  it("Usage: shows each plan window with its reset, and each action's cost and estimate", async () => {
    const client = new FakeClient(ready);
    const reset = new Date(Date.now() + 2 * 3600_000).toISOString();
    client.usage = { limits: [{ kind: "five_hour", utilization: 0.84, resetsAt: reset }], estimates: { tidy: 0.08 } };
    client.state.actions = {
      tidy: { label: { es: "Ordenar", en: "Tidy up" }, cost: "heavy" },
      note: { label: { es: "Nota", en: "Quick note" }, cost: "light" },
    };
    await renderIn("en", <Sheet client={client} initialTab="usage" />);
    expect((await screen.findByText("5 h: 84% used")).className).toBe("hh-warn");
    expect(screen.getByText(`Resets ${formatReset(reset, "en")}`)).toBeTruthy();
    expect(screen.getByText("Heavy · Usually about 8% of the 5-hour window")).toBeTruthy();
    expect(screen.getByText("Light")).toBeTruthy();
  });

  it("Usage: leaves out plan windows that have already reset", async () => {
    const client = new FakeClient(ready);
    const past = new Date(Date.now() - 60_000).toISOString();
    const later = new Date(Date.now() + 4 * 86400_000).toISOString();
    client.usage = {
      limits: [
        { kind: "five_hour", utilization: 0.97, resetsAt: past },
        { kind: "seven_day", utilization: 0.3, resetsAt: later },
      ],
      estimates: {},
    };
    await renderIn("en", <Sheet client={client} initialTab="usage" />);
    await screen.findByText("week: 30% used");
    expect(screen.queryByText(/5 h:/)).toBeNull();
  });

  it("Usage: says when the engine doesn't report limits, and when the app has no actions", async () => {
    const client = new FakeClient({ ...ready, engineId: "codex" });
    client.state.engines = [{ ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false }];
    await renderIn("en", <Sheet client={client} initialTab="usage" />);
    await screen.findByText("Codex doesn't report your plan's limits.");
    expect(screen.getByText("This app doesn't declare any actions.")).toBeTruthy();
  });
});
