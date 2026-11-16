// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../../../ui/src";
import { FakeClient } from "../../../ui/test/fake-client";
import { render } from "./home-block";

afterEach(cleanup);
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

async function start(client: FakeClient) {
  render(<HarnessApp client={client} />);
  const button = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
  await screen.findByRole("navigation", { name: "App" });
}
const bar = () => document.querySelector<HTMLElement>(".hh-shell header.hh-topbar")!;

describe("the one bar steps in only while a task is open (task view one column, DESIGN.md §10)", () => {
  it("the start view keeps its breadcrumb and the gear; a task brings the one bar, and its end gives them back", async () => {
    const client = new FakeClient(ready);
    await start(client);
    const crumbs = within(bar()).getByRole("navigation", { name: "Breadcrumb" });
    expect(crumbs.querySelector("[aria-current=page]")).not.toBeNull();
    expect(bar().querySelector(".hh-tb-switch")).toBeNull();
    expect(within(bar()).getByRole("button", { name: "Settings" })).toBeTruthy();
    await act(() => client.emitTasks({ current: { id: "t1", status: "waiting" }, actions: {}, notes: [] }));
    await waitFor(() => expect(bar().querySelector(".hh-topbar-slot .hh-tb-switch")).not.toBeNull());
    expect(bar().querySelector("[aria-current=page]")).toBeNull();
    expect(within(bar()).queryByRole("button", { name: "Settings" })).toBeNull();
    await act(() => client.emitTasks({ current: null, actions: {}, notes: [] }));
    await waitFor(() => expect(bar().querySelector(".hh-tb-switch")).toBeNull());
    expect(within(bar()).getByRole("navigation", { name: "Breadcrumb" }).querySelector("[aria-current=page]")).not.toBeNull();
  });

  it("without a task, a note opened from Files keeps the top bar's Volver, which reads Notes", async () => {
    const client = new FakeClient(ready);
    client.state.actions = { manifest: { label: "The manifest", cost: "medium" } };
    client.state.path = ["manifest"];
    client.tasks = {
      current: null,
      actions: {},
      notes: [{ slug: "manifest", title: "The manifest", action: "manifest", date: "2026-10-12T11:20:00.000Z", summary: ["One point"], decisions: [], path: ".harness/notes/manifest.md" }],
    };
    await start(client);
    fireEvent.click(within(screen.getByRole("navigation", { name: "App" })).getByRole("button", { name: "Files" }));
    fireEvent.click(within(await screen.findByRole("region", { name: "Files" })).getByRole("button", { name: /The manifest/ }));
    await screen.findByRole("region", { name: "The manifest" });
    fireEvent.click(within(bar()).getByRole("button", { name: "Back to Notes" }));
    expect(await screen.findByRole("region", { name: "Files" })).toBeTruthy();
  });
});
