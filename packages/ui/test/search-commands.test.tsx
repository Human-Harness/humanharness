// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createI18n } from "@humanharness/i18n";
import { HarnessApp } from "../src";
import type { SearchHitView } from "../src/client";
import { commandRows, settingRows } from "../src/search/local";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

async function startWork() {
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByPlaceholderText(/Write a message…/);
}

const titleOf = (h: SearchHitView) => h.title.map((p) => p.text).join("");

describe("actions in the palette (search spec §6; plan 1 deviation 9)", () => {
  it("nothing typed lists the actions available now; Open History opens it", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open(""));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    const actions = await within(dialog).findByRole("group", { name: "Actions" });
    expect(within(actions).queryByText("Stop the AI")).toBeNull();
    fireEvent.click(within(actions).getByText("Open History"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    expect(await screen.findByRole("heading", { name: "History" })).toBeTruthy();
  });

  it("Open Settings › Engine opens that tab", async () => {
    const client = new FakeClient(ready);
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("settings engine"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    const actions = await within(dialog).findByRole("group", { name: "Actions" });
    // The typed words are marked, so the label is split across elements: find its option by text content.
    const row = await waitFor(() => {
      const o = within(actions).getAllByRole("option").find((e) => e.textContent?.includes("Open Settings › Engine"));
      if (!o) throw new Error("no Engine row");
      return o;
    });
    fireEvent.click(row);
    const sheet = await screen.findByRole("main", { name: "Settings" });
    expect(within(sheet).getByRole("tab", { name: "Engine" }).getAttribute("aria-selected")).toBe("true");
  });

  it("New question focuses an empty composer and sends nothing; an action opened from search reaches neither main nor the recents", async () => {
    const client = new FakeClient(ready);
    const opened: SearchHitView[] = [];
    client.search.opened = async (hit) => {
      opened.push(hit);
      return { ok: true };
    };
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open(""));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.click(within(await within(dialog).findByRole("group", { name: "Actions" })).getByText("New question"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    const box = screen.getByPlaceholderText(/Write a message…/) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(box));
    expect(box.value).toBe("");
    expect(client.sent).toEqual([]);
    expect(opened).toEqual([]);
  });

  it("Switch to <scope> opens that scope and sends nothing; archived and open scopes aren't offered", async () => {
    const client = new FakeClient(ready);
    client.state = { ...client.state, scopes: { label: "topic", plural: "topics" } };
    client.scopeList = [
      { id: "physics", title: "Physics", createdAt: "c", archived: false },
      { id: "maths", title: "Maths", createdAt: "c", archived: false },
      { id: "old", title: "Last term", createdAt: "c", archived: true },
    ];
    client.openScope = "physics";
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    act(() => client.search.open("switch"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    const actions = await within(dialog).findByRole("group", { name: "Actions" });
    expect(within(actions).queryByText(/Physics/)).toBeNull();
    expect(within(actions).queryByText(/Last term/)).toBeNull();
    fireEvent.click(within(actions).getByText(/Maths/));
    await waitFor(() => expect(client.openScope).toBe("maths"));
    expect(client.sent).toEqual([]);
  });
});

describe("the order of the window's rows", () => {
  const ready2 = { language: "en" as const, folder: "/w", engineId: "claude" };

  it("Actions: a label match before a keyword match, the table's order between equals; no match is left out", async () => {
    const client = new FakeClient(ready2);
    const i18n = await createI18n("en");
    const chat = { taskOpen: true, turnRunning: false, nextPart: null, panels: true };
    // "open" starts every "Open …" label (2) and is a keyword of "Switch to …" (1).
    const rows = commandRows(i18n.t, client.state, "open", chat, [{ id: "maths", title: "Maths", createdAt: "c", archived: false }], null);
    const titles = rows.map(titleOf);
    expect(titles.at(-1)).toBe("Switch to Maths");
    expect(titles.slice(0, 3)).toEqual(["Open History", "Open what's clear so far", "Open what the AI takes into account"]);
    expect(titles).not.toContain("New question");
    expect(commandRows(i18n.t, client.state, "zzz", chat, [], null)).toEqual([]);
  });

  it("Actions with nothing typed: every available one, in the table's order", async () => {
    const client = new FakeClient(ready2);
    const i18n = await createI18n("en");
    const rows = commandRows(i18n.t, client.state, "  ", { taskOpen: false, turnRunning: false, nextPart: null, panels: true }, [], null);
    expect(rows.map((r) => r.id).slice(0, 3)).toEqual(["command:new-question", "command:open-history", "command:open-notes"]);
    expect(rows.map((r) => r.id)).not.toContain("command:open-context");
    expect(rows.every((r) => r.id.startsWith("command:"))).toBe(true);
  });

  it("Settings: a label match before a section or keyword match, the table's order between equals; no match is left out", async () => {
    const client = new FakeClient(ready2);
    const i18n = await createI18n("en");
    const ids = (q: string) => settingRows(i18n.t, client.state, q).map((r) => r.id);
    // "us" starts "uses" in "How much each topic uses" (label) but only the section "Usage" of "Your plan now".
    expect(ids("us")).toEqual(["setting:usage.actions", "setting:usage.plan"]);
    // "usage" is in neither label: both by section, in the table's order.
    expect(ids("usage")).toEqual(["setting:usage.plan", "setting:usage.actions"]);
    expect(ids("zzz")).toEqual([]);
  });
});
