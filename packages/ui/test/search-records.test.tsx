// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { SearchAnswer, SearchHitView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const ANA: SearchHitView = { id: "data:harness:_app/people#a", kind: "data", title: [{ text: "Ana" }], context: [], hint: null, target: { kind: "record", collection: "people", key: "a", scope: "_app" } };
const ISSUE: SearchHitView = { id: "data:plugin:jira/issues#J-1", kind: "data", title: [{ text: "Login fails" }], context: [], plugin: "Jira", hint: null, target: { kind: "none" } };
const answer = (query: string, hits: SearchHitView[]): SearchAnswer => ({
  ok: true,
  query,
  groups: [{ kind: "data", total: hits.length, hits }],
  counts: { task: 0, note: 0, file: 0, data: hits.length },
  recent: [],
  partial: false,
  status: { state: "ready", done: 1, total: 1 },
  allScopes: false,
});

async function startWork() {
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByPlaceholderText(/Write a message…/);
}

describe("data records in the palette (search spec §3 Data)", () => {
  it("a harness record goes to the view that listens for its collection", async () => {
    const client = new FakeClient(ready);
    client.searchAnswers.ana = answer("ana", [ANA]);
    const heard = vi.fn();
    client.search.onOpenRecord("people", heard);
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("ana"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(await within(dialog).findByRole("group", { name: "Data" })).toBeTruthy();
    expect(within(dialog).queryByText("Shown in Demo")).toBeNull();
    fireEvent.click(await within(dialog).findByRole("option"));
    await waitFor(() => expect(heard).toHaveBeenCalledWith("a", "_app"));
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it('without a listener the row says "Shown in <harness>"; a plugin record without a panel says where it is from and opens nothing', async () => {
    const client = new FakeClient(ready);
    client.searchAnswers.x = answer("x", [ANA, ISSUE]);
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("x"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(await within(dialog).findByText("Shown in Demo")).toBeTruthy();
    expect(within(dialog).getByText("From Jira")).toBeTruthy();
    fireEvent.click(within(dialog).getAllByRole("option")[1]);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    expect(client.searchOpened.map((h) => h.id)).toEqual([ISSUE.id]);
  });
});
