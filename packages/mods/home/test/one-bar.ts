import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { expect } from "vitest";
import type { FakeClient } from "../../../ui/test/fake-client";

/** The rail's History (task view one column): only while a task is open, so one opens first. */
export async function railHistory(client: FakeClient) {
  if (!client.tasks.current) act(() => client.emitTasks({ current: { id: "t1", status: "waiting" }, actions: {}, notes: [] }));
  fireEvent.click(await within(screen.getByRole("navigation", { name: "App" })).findByRole("button", { name: "History" }));
}

/** The plan's usage sits in the bar's context chip (task view one column): a task with context opens, the chip opens. */
export async function openUsage(client: FakeClient) {
  if (!client.tasks.current) act(() => client.emitTasks({ current: { id: "t1", status: "waiting", context: { used: 40_000, cap: 200_000 } }, actions: {}, notes: [] }));
  fireEvent.click(await screen.findByRole("button", { name: /^Context \d+%$/ }));
  return screen.findByRole("dialog");
}
/** Waits until the chip's popover shows `text`, then closes it again. */
export async function seeUsage(client: FakeClient, text: string | RegExp) {
  await within(await openUsage(client)).findByText(text);
  fireEvent.click(screen.getByRole("button", { name: /^Context \d+%$/ }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

/** The bar's button for an overlay (task view one column), by the overlay it controls. */
async function overlayButton(id: string): Promise<HTMLElement> {
  return waitFor(() => {
    const b = document.querySelector<HTMLElement>(`button[aria-controls="${id}"]`);
    if (!b) throw new Error(`no button for ${id}`);
    return b;
  });
}

/** Unfolds the left overlay: the path, or the material / Plugins / harness panel without one. */
export async function openSide(): Promise<HTMLElement> {
  const button = await overlayButton("hh-overlay-path");
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
  return waitFor(() => document.getElementById("hh-overlay-path") ?? Promise.reject(new Error("no left overlay")));
}

/** Unfolds Sidekick's overlay from its button in the bar. */
export async function openSidekick(): Promise<HTMLElement> {
  const button = await overlayButton("hh-overlay-sidekick");
  if (button.getAttribute("aria-expanded") !== "true") fireEvent.click(button);
  return waitFor(() => document.getElementById("hh-overlay-sidekick") ?? Promise.reject(new Error("no Sidekick overlay")));
}
