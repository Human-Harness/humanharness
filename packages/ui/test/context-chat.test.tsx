// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { TaskContext } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const PANEL = "What the AI takes into account";
const CTX: TaskContext = {
  task: "t1",
  scope: "main",
  scoped: false,
  start: [{ id: "brief", kind: "brief", label: "Task brief", tokens: 300 }],
  reads: [
    { kind: "read", label: "docs/plan.md", path: "docs/plan.md", firstAt: "2026-10-28T10:00:00.000Z", count: 1 },
    { kind: "read", label: "src/a.ts", path: "src/a.ts", firstAt: "2026-10-28T10:01:00.000Z", count: 1 },
  ],
  compacted: false,
  pins: [],
  excluded: [],
  budget: 3000,
};

async function openApp(actions = true) {
  const client = new FakeClient(ready);
  if (actions) {
    client.state.actions = { manifest: { label: "The manifest", cost: "medium" } };
    client.state.path = ["manifest"];
  }
  client.contexts.t1 = CTX;
  client.docTexts["docs/plan.md"] = "# Plan\n\nThe plan.\n";
  client.tasks = {
    current: { id: "t1", ...(actions ? { action: "manifest" } : {}), status: "waiting", context: { used: 40_000, cap: 200_000 } },
    actions: {},
    notes: [],
  };
  render(<HarnessApp client={client} locales={{ en: {} }} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  return client;
}

const panel = () => screen.findByRole("region", { name: PANEL });
const openPanel = async () => {
  fireEvent.click(await screen.findByRole("button", { name: PANEL }));
  return panel();
};

describe("the context panel in the app (context-panel spec §5.1)", () => {
  it("the meter is a button that opens the panel; Close closes it", async () => {
    await openApp();
    // One meter: the flow side's, not a second one in the top bar.
    expect(await screen.findAllByRole("button", { name: PANEL })).toHaveLength(1);
    expect(screen.getByRole("meter", { name: "Context in use" })).toBeTruthy();
    const p = await openPanel();
    fireEvent.click(within(p).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: PANEL })).toBeNull());
  });

  it("a .md opens in the reader, any other file in the file timeline panel", async () => {
    await openApp();
    let p = await openPanel();
    fireEvent.click(await within(p).findByRole("button", { name: "docs/plan.md" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: PANEL })).toBeNull());
    expect(await screen.findByRole("complementary", { name: "Document" })).toBeTruthy();
    p = await openPanel();
    // The panel takes the reader's slot: one side panel at a time.
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
    fireEvent.click(await within(p).findByRole("button", { name: "src/a.ts" }));
    expect(await screen.findByRole("heading", { name: /a\.ts/ })).toBeTruthy();
    expect(screen.queryByRole("region", { name: PANEL })).toBeNull();
  });

  it("without actions the meter sits in the top bar", async () => {
    await openApp(false);
    expect(screen.queryByRole("region", { name: PANEL })).toBeNull();
    await openPanel();
  });

  it("Close and Escape give focus back to the meter that opened the panel", async () => {
    await openApp();
    const meter = await screen.findByRole("button", { name: PANEL });
    meter.focus();
    let p = await openPanel();
    within(p).getByRole("button", { name: "Close" }).focus();
    fireEvent.click(within(p).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: PANEL })).toBeNull());
    expect(document.activeElement).toBe(meter);
    meter.focus();
    p = await openPanel();
    within(p).getByRole("button", { name: "Close" }).focus();
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("region", { name: PANEL })).toBeNull());
    expect(document.activeElement).toBe(meter);
  });

  it("the panel closes when the task ends", async () => {
    const client = await openApp();
    await openPanel();
    await act(() => client.emitTasks({ ...client.tasks, current: null }));
    await waitFor(() => expect(screen.queryByRole("region", { name: PANEL })).toBeNull());
  });
});
