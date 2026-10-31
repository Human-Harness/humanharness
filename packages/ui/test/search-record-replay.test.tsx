// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { HarnessClient, SearchAnswer, SearchHitView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const ANA: SearchHitView = { id: "data:harness:_app/people#a", kind: "data", title: [{ text: "Ana" }], context: [], hint: null, target: { kind: "record", collection: "people", key: "a", scope: "_app" } };
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

/** A harness side panel that listens for its collection once it mounts, as a harness view would. */
function People({ client, heard }: { client: HarnessClient; heard: (key: string | number | null, scope: string) => void }) {
  useEffect(() => client.search.onOpenRecord("people", heard), [client, heard]);
  return <p>People</p>;
}

describe("a record picked away from the work screen (search spec §3 Data)", () => {
  it("reaches the harness view that mounts with the work screen: its listener registers before the replay runs", async () => {
    const client = new FakeClient(ready);
    client.searchAnswers.ana = answer("ana", [ANA]);
    const heard = vi.fn();
    render(<HarnessApp client={client} renderSide={() => <People client={client} heard={heard} />} />);
    await screen.findByRole("button", { name: "Start Demo" });
    expect(client.search.handlesRecord("people")).toBe(false);
    act(() => client.search.open("ana"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.click(await within(dialog).findByRole("option"));
    await waitFor(() => expect(heard).toHaveBeenCalledWith("a", "_app"));
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
