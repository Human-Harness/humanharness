// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { AttentionItemView, AttentionView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

const item = (over: Partial<AttentionItemView> = {}): AttentionItemView => ({
  plugin: "oncall",
  pluginName: "On-call",
  key: "k1",
  severity: "action",
  title: "PagerDuty: checkout is down",
  body: "Triggered 3 minutes ago.",
  at: new Date(Date.now() - 5 * 60_000).toISOString(),
  read: false,
  hasTarget: false,
  ...over,
});
const view = (items: AttentionItemView[], badge = items.filter((i) => !i.read).length): AttentionView => ({ items, badge, show: true });

function client(attention: AttentionView | null, withPlugins = true) {
  const c = new FakeClient(ready);
  if (withPlugins) c.state.plugins = { local: true };
  c.attentionView = attention;
  return c;
}
async function open(c: FakeClient) {
  render(<HarnessApp client={c} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByRole("textbox");
  // The top bar is up (the History button sits right after the inbox).
  await screen.findByRole("button", { name: "History" });
}
const bell = () => screen.findByRole("button", { name: "Attention" });

describe("Attention inbox", () => {
  it("D0: without state.plugins there is no inbox and nothing is asked", async () => {
    const c = client(view([item()]), false);
    const get = vi.spyOn(c.attention, "get");
    const sub = vi.spyOn(c.attention, "onChange");
    await open(c);
    expect(screen.queryByRole("button", { name: "Attention" })).toBeNull();
    expect(get).not.toHaveBeenCalled();
    expect(sub).not.toHaveBeenCalled();
  });

  it("D0: with state.plugins but show false (nothing on, no items) there is no inbox", async () => {
    const c = client({ items: [], badge: 0, show: false });
    const get = vi.spyOn(c.attention, "get");
    await open(c);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "Attention" })).toBeNull();
  });

  it("shows the badge main sends, and none at 0", async () => {
    // Main's count wins even if it differs from the unread items here: the UI never recounts.
    const c = client(view([item()], 2));
    await open(c);
    const b = await bell();
    expect(b.getAttribute("aria-haspopup")).toBe("dialog");
    expect(within(b).getByText("2")).toBeTruthy();
    expect(within(b).getByText("2 unread")).toBeTruthy();
    expect(b.getAttribute("aria-describedby")).toBeTruthy();
    act(() => c.emitAttention(view([item({ read: true })], 0)));
    await waitFor(() => expect(within(b).queryByText("2")).toBeNull());
    expect(b.querySelector(".hh-pl-badge")).toBeNull();
  });

  it("a push updates the badge without a refetch, and is announced", async () => {
    const c = client(view([item()]));
    const get = vi.spyOn(c.attention, "get");
    await open(c);
    const b = await bell();
    await waitFor(() => expect(within(b).getByText("1")).toBeTruthy());
    const calls = get.mock.calls.length;
    act(() => c.emitAttention(view([item(), item({ key: "k2", title: "Second" })])));
    await waitFor(() => expect(within(b).getByText("2")).toBeTruthy());
    expect(get.mock.calls.length).toBe(calls);
    expect(document.querySelector(".hh-pl-inbox [aria-live]")?.textContent).toBe("2 unread");
  });

  it("opens a list of items; reading and dismissing go to main; Escape returns focus", async () => {
    const c = client(view([item(), item({ key: "k2", severity: "info", title: "Old news", body: undefined, read: true, at: new Date(Date.now() - 3 * 86_400_000).toISOString() })]));
    await open(c);
    const b = await bell();
    fireEvent.click(b);
    const dialog = await screen.findByRole("dialog", { name: "Attention" });
    expect(b.getAttribute("aria-expanded")).toBe("true");
    const d = within(dialog);
    expect(d.getByText("PagerDuty: checkout is down")).toBeTruthy();
    expect(d.getByText("Triggered 3 minutes ago.")).toBeTruthy();
    expect(d.getAllByText("On-call").length).toBe(2);
    expect(d.getByText("5 minutes ago")).toBeTruthy();
    expect(d.getByText("3 days ago")).toBeTruthy();
    expect(d.getByText("Needs you")).toBeTruthy();
    expect(d.getByText("Info")).toBeTruthy();
    // Unread is marked (one item), and opening the list read nothing.
    expect(d.getAllByText("Unread").length).toBe(1);
    expect(dialog.querySelectorAll('[data-unread="true"]').length).toBe(1);
    expect(c.pluginCalls).toEqual([]);
    // Focus moved into the list.
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.click(d.getByRole("button", { name: /PagerDuty: checkout is down/ }));
    await waitFor(() => expect(c.pluginCalls).toEqual([["attention.read", "oncall", "k1"]]));
    fireEvent.click(d.getAllByRole("button", { name: "Dismiss" })[1]);
    await waitFor(() => expect(c.pluginCalls).toContainEqual(["attention.dismiss", "oncall", "k2"]));

    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Attention" })).toBeNull());
    expect(document.activeElement).toBe(b);
    expect(b.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps focus in the list when a dismissed item leaves it", async () => {
    const c = client(view([item(), item({ key: "k2", title: "Second" })]));
    await open(c);
    fireEvent.click(await bell());
    const dialog = await screen.findByRole("dialog", { name: "Attention" });
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Dismiss" })[0]);
    act(() => c.emitAttention(view([item({ key: "k2", title: "Second" })])));
    await waitFor(() => expect(within(dialog).queryByText("PagerDuty: checkout is down")).toBeNull());
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("B12: plugin text is plain text, never markup", async () => {
    const evil = "<img src=x onerror=alert(1)>";
    const c = client(view([item({ title: evil, body: "**bold** <b>x</b>", pluginName: "<i>p</i>" })]));
    await open(c);
    fireEvent.click(await bell());
    const dialog = await screen.findByRole("dialog", { name: "Attention" });
    expect(within(dialog).getByText(evil)).toBeTruthy();
    expect(within(dialog).getByText("**bold** <b>x</b>")).toBeTruthy();
    expect(within(dialog).getByText("<i>p</i>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
    expect(dialog.querySelector("b, i, strong")).toBeNull();
  });

  it("an empty list says so", async () => {
    const c = client({ items: [], badge: 0, show: true });
    await open(c);
    fireEvent.click(await bell());
    const dialog = await screen.findByRole("dialog", { name: "Attention" });
    expect(within(dialog).getByText("Nothing needs you now.")).toBeTruthy();
  });

  it("closes on a click outside", async () => {
    const c = client(view([item()]));
    await open(c);
    fireEvent.click(await bell());
    await screen.findByRole("dialog", { name: "Attention" });
    fireEvent.mouseDown(document.body);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Attention" })).toBeNull());
  });

  it("plugin text sets its own direction (dir=auto), so a right-to-left title can't flip the row", async () => {
    const c = client(view([item()]));
    await open(c);
    fireEvent.click(await bell());
    const dialog = await screen.findByRole("dialog", { name: "Attention" });
    for (const text of ["PagerDuty: checkout is down", "Triggered 3 minutes ago.", "On-call"]) {
      expect(within(dialog).getByText(text).getAttribute("dir")).toBe("auto");
    }
  });

  it("closes when focus leaves it, not when it moves inside", async () => {
    const c = client(view([item()]));
    await open(c);
    const b = await bell();
    fireEvent.click(b);
    const dialog = await screen.findByRole("dialog", { name: "Attention" });
    const dismiss = within(dialog).getByRole("button", { name: "Dismiss" });
    fireEvent.focusOut(within(dialog).getAllByRole("button")[0], { relatedTarget: dismiss });
    expect(screen.queryByRole("dialog", { name: "Attention" })).toBeTruthy();
    fireEvent.focusOut(dismiss, { relatedTarget: b });
    expect(screen.queryByRole("dialog", { name: "Attention" })).toBeTruthy();
    fireEvent.focusOut(dismiss, { relatedTarget: screen.getByRole("textbox") });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Attention" })).toBeNull());
  });

  it("a failed dismiss leaves no focus pending for a later list", async () => {
    const c = client(view([item(), item({ key: "k2", title: "Second" })]));
    vi.spyOn(c.attention, "dismiss").mockRejectedValue(new Error("no"));
    await open(c);
    fireEvent.click(await bell());
    const dialog = await screen.findByRole("dialog", { name: "Attention" });
    fireEvent.click(within(dialog).getAllByRole("button", { name: "Dismiss" })[1]);
    await act(async () => {});
    const first = dialog.querySelector<HTMLButtonElement>(".hh-pl-item-main")!;
    first.focus();
    act(() => c.emitAttention(view([item({ title: "Updated" }), item({ key: "k2", title: "Second" })])));
    await within(dialog).findByText("Updated");
    expect(document.activeElement).toBe(first);
  });
});
