// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { ModelsView, SettingsView } from "../src/client";
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
    { name: "nickname", control: "text", label: "What the app calls you", default: "", max: 40 },
    { name: "hintAfter", control: "number", label: "Hint after", unit: "tries", advanced: true, default: 2, min: 1, max: 5, agent: true },
  ],
};

async function openFirst(client: FakeClient, query: string) {
  act(() => client.search.open(query));
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  await within(dialog).findByRole("group", { name: "Settings" });
  fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Enter" });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
  return screen.findByRole("dialog", { name: "Settings" });
}

describe("a second search while Settings is open keeps the tab as it was (§6)", () => {
  it("the harness's tab keeps a refusal on screen, and an advanced field still opens More settings", async () => {
    const client = new FakeClient(ready);
    client.state.settings = HARNESS;
    client.settingsState = { values: { nickname: "", hintAfter: 2 }, pending: [] };
    client.settingsFailure = { ok: false, message: "Not that name." };
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    let sheet = await openFirst(client, "what the app");
    const box = within(sheet).getByRole("textbox", { name: "What the app calls you" });
    await waitFor(() => expect(document.activeElement).toBe(box));
    fireEvent.change(box, { target: { value: "Ace" } });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await within(sheet).findByText("Not that name.")).toBeTruthy();
    sheet = await openFirst(client, "hint after");
    await waitFor(() => expect(document.activeElement).toBe(within(sheet).getByRole("spinbutton", { name: "Hint after" })));
    expect(within(sheet).getByText("Not that name.")).toBeTruthy();
  });

  it("Models moves to the part of the field searched, without starting over", async () => {
    const client = new FakeClient(ready);
    client.state.models = MODELS;
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    let sheet = await openFirst(client, "levels");
    await waitFor(() => expect(sheet.querySelector('[data-setting="models.levels"]')?.contains(document.activeElement)).toBe(true));
    sheet = await openFirst(client, "pinned");
    await waitFor(() => expect(sheet.querySelector('[data-setting="models.tasks"]')?.contains(document.activeElement)).toBe(true));
    sheet = await openFirst(client, "levels");
    await waitFor(() => expect(sheet.querySelector('[data-setting="models.levels"]')?.contains(document.activeElement)).toBe(true));
  });
});
