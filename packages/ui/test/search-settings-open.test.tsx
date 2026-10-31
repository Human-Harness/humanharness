// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "@humanharness/i18n";
import { HarnessApp } from "../src";
import type { ModelsView, SettingsView } from "../src/client";
import { settingRows } from "../src/search/local";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const MODELS: ModelsView = {
  recommended: { questions: "standard" },
  defaults: { claude: { light: { model: "haiku", effort: "low", cap: 100_000 }, standard: { model: "sonnet", effort: "medium", cap: 200_000 }, deep: { model: "opus", effort: "high", cap: 400_000 } } },
  offered: { claude: { models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low", "medium", "high", "xhigh", "max"] } },
  pinnedTokens: 3000,
};
const HARNESS: SettingsView = {
  tab: "How I learn",
  sections: [],
  fields: [
    { name: "nickname", control: "text", label: "What the app calls you", help: "Only the app's screens use it.", default: "Captain Secretname", max: 40 },
    { name: "hintAfter", control: "number", label: "Hint after", unit: "tries", advanced: true, default: 2, min: 1, max: 5, agent: true },
  ],
};

/** The search's first result, opened with Enter. */
async function openFirst(client: FakeClient, query: string) {
  act(() => client.search.open(query));
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  await within(dialog).findByRole("group", { name: "Settings" });
  fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
  return screen.findByRole("dialog", { name: "Settings" });
}

describe("a setting from search opens Settings at the field (§6)", () => {
  it("typing a label shows it under Settings; Enter opens the tab with its control focused", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    act(() => client.search.open("appear"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    const group = await within(dialog).findByRole("group", { name: "Settings" });
    expect(within(group).getByRole("option").textContent).toContain("Appearance");
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Enter" });
    const sheet = await screen.findByRole("dialog", { name: "Settings" });
    expect(within(sheet).getByRole("tab", { name: "General" }).getAttribute("aria-selected")).toBe("true");
    const row = sheet.querySelector<HTMLElement>('[data-setting="general.appearance"]')!;
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true));
    expect(row.classList.contains("hh-search-flash")).toBe(true);
    // A window row never reaches main (§6): not remembered as opened.
    expect(client.searchOpened).toEqual([]);
  });

  it("Models › Levels opens on its Levels part", async () => {
    const client = new FakeClient(ready);
    client.state.models = MODELS;
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    const sheet = await openFirst(client, "levels");
    expect(within(sheet).getByRole("tab", { name: "Models" }).getAttribute("aria-selected")).toBe("true");
    const row = await waitFor(() => sheet.querySelector<HTMLElement>('[data-setting="models.levels"]')!);
    await waitFor(() => expect(row.contains(document.activeElement)).toBe(true));
  });

  it("an advanced harness field opens with More settings expanded, focused", async () => {
    const client = new FakeClient(ready);
    client.state.settings = HARNESS;
    client.settingsState = { values: { nickname: "", hintAfter: 2 }, pending: [] };
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    const sheet = await openFirst(client, "hint after");
    expect(within(sheet).getByRole("tab", { name: "How I learn" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole("spinbutton", { name: "Hint after" })));
    expect(sheet.querySelector('[data-setting="harness:hintAfter"]')!.classList.contains("hh-search-flash")).toBe(true);
  });

  it("with Settings already open, a setting from search moves the sheet to its tab and field", async () => {
    const client = new FakeClient(ready);
    client.state.models = MODELS;
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    let sheet = await openFirst(client, "appear");
    await waitFor(() => expect(sheet.querySelector('[data-setting="general.appearance"]')!.contains(document.activeElement)).toBe(true));
    sheet = await openFirst(client, "levels");
    expect(within(sheet).getByRole("tab", { name: "Models" }).getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(sheet.querySelector('[data-setting="models.levels"]')?.contains(document.activeElement)).toBe(true));
    // The same field again is a new focus: it gets focus back after the person moved on.
    within(sheet).getByRole("button", { name: "Done" }).focus();
    sheet = await openFirst(client, "levels");
    await waitFor(() => expect(sheet.querySelector('[data-setting="models.levels"]')?.contains(document.activeElement)).toBe(true));
  });

  it("closing the sheet gives focus back to what had it before search; the gear later opens it plain", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    start.focus();
    expect(document.activeElement).toBe(start);
    const sheet = await openFirst(client, "appear");
    await waitFor(() => expect(sheet.querySelector('[data-setting="general.appearance"]')!.contains(document.activeElement)).toBe(true));
    fireEvent.click(within(sheet).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
    expect(document.activeElement).toBe(start);
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const again = await screen.findByRole("dialog", { name: "Settings" });
    await new Promise((r) => setTimeout(r, 50));
    expect(document.activeElement).toBe(within(again).getByRole("button", { name: "Done" }));
    expect(again.querySelector(".hh-search-flash")).toBeNull();
  });
});

describe("which settings search offers (§6)", () => {
  it("a hidden tab's rows and a row whose condition fails are not offered", async () => {
    const { t } = await createI18n("en");
    const client = new FakeClient(ready);
    // No Models view, no Connections, no Jobs, no parallel: none of their rows.
    const ids = (q: string) => settingRows(t, client.state, q).map((h) => h.id);
    expect(ids("levels")).toEqual([]);
    expect(ids("connections")).toEqual([]);
    expect(ids("tokens")).not.toContain("setting:connections.connections");
    expect(ids("parallel")).toEqual([]);
    expect(ids("jobs")).toEqual([]);
    client.state.models = MODELS;
    expect(ids("levels")).toEqual(["setting:models.levels"]);
    // Before the app is configured only General's rows are offered (the other tabs show "set up first").
    const fresh = new FakeClient({ language: "en" });
    fresh.state.models = MODELS;
    expect(settingRows(t, fresh.state, "levels")).toEqual([]);
    expect(settingRows(t, fresh.state, "appearance").map((h) => h.id)).toEqual(["setting:general.appearance"]);
  });

  it("rows carry labels only: never a setting's value", async () => {
    const { t } = await createI18n("en");
    const client = new FakeClient(ready);
    client.state.settings = HARNESS;
    client.state.connections = { count: 2 };
    const rows = [...settingRows(t, client.state, "what"), ...settingRows(t, client.state, "connections"), ...settingRows(t, client.state, "captain")];
    expect(rows.map((h) => h.id)).toEqual(["setting:harness:nickname", "setting:connections.connections"]);
    const shown = JSON.stringify(rows.map(({ title, context, hint }) => ({ title, context, hint })));
    expect(shown).not.toContain("Secretname");
    expect(rows.every((h) => h.hint === null)).toBe(true);
  });
});
