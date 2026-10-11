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

function Sheet({ client, initialTab = "general", onClose = () => {} }: { client: FakeClient; initialTab?: SettingsTab; onClose?: () => void }) {
  const [state, setState] = useState<AppState>(client.state);
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  return <SettingsSheet client={client} state={state} tab={tab} onTab={setTab} onChange={setState} onClose={onClose} />;
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

  it("General: changes language and appearance, shows the fixed folder and the About card", async () => {
    const client = new FakeClient(ready);
    await renderIn("en", <Sheet client={client} />);
    fireEvent.click(screen.getByRole("button", { name: "Dark" }));
    await waitFor(() => expect(client.state.config.appearance).toBe("dark"));
    expect(screen.getByText("/Users/me/Documents/Demo")).toBeTruthy();
    expect(screen.getByText("Chosen at setup; it can't be changed.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    await waitFor(() => expect(client.revealed).toBe(1));
    expect(screen.getByText("Version 0.1.0")).toBeTruthy();
    expect(screen.getByText("Made by Marco Zanger with Human Harness")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Support" }).getAttribute("href")).toBe("https://example.com/donate");
    fireEvent.click(screen.getByRole("button", { name: "Español" }));
    await screen.findByRole("tab", { name: "Motor" });
    expect(client.state.config.language).toBe("es");
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

  it("Usage: says when the engine doesn't report limits, and when the app has no actions", async () => {
    const client = new FakeClient({ ...ready, engineId: "codex" });
    client.state.engines = [{ ...client.state.engines[0], id: "codex", name: "Codex", provider: "OpenAI", reportsLimits: false }];
    await renderIn("en", <Sheet client={client} initialTab="usage" />);
    await screen.findByText("Codex doesn't report your plan's limits.");
    expect(screen.getByText("This app doesn't declare any actions.")).toBeTruthy();
  });
});
