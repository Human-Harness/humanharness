// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ChatView } from "../src/ChatView";
import type { ChatEntry, Review } from "../src/client";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);
const card = { path: "specs/a.md", title: "Filter", kind: "spec", change: "new" as const, words: 120 };
const answer: ChatEntry = { id: "a1", role: "assistant", text: "I wrote the spec.", blocks: [], activities: [], at: "2026-10-28T10:00:00.000Z", engine: "claude", documents: [card] };

async function chat(review: boolean) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.chat = [answer];
  client.docTexts[card.path] = "## Scope\n\nFilter by size.\n";
  if (review) client.state.review = true;
  await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />);
  return client;
}
async function openReader() {
  fireEvent.click(await screen.findByRole("button", { name: /Filter/ }));
  return screen.findByRole("complementary", { name: "Document" });
}

describe("focus mode (review spec §6.2)", () => {
  it("'Focus' shows only the document, holds the turn's end, and Esc leaves with a summary", async () => {
    const client = await chat(true);
    const composer = screen.getByRole("textbox");
    fireEvent.change(composer, { target: { value: "Go on" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const reader = await openReader();
    fireEvent.click(within(reader).getByRole("button", { name: "Focus" }));
    expect(document.querySelector(".hh-body.hh-focus")).not.toBeNull();
    expect(client.focus.current()).toEqual({ on: true, path: "specs/a.md" });
    expect(within(reader).getByRole("button", { name: "Leave focus" })).toBeTruthy();
    act(() => client.emit({ type: "done", ok: false, error: { code: "out-of-quota" } }));
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
    expect(document.querySelector("[aria-live='polite']")?.textContent).toBe("");
    fireEvent.keyDown(await within(reader).findByRole("heading", { name: "Scope" }), { key: "Escape" });
    expect(document.querySelector(".hh-focus")).toBeNull();
    expect(screen.getByRole("complementary", { name: "Document" })).toBeTruthy();
    expect(await screen.findByText("While you were reading: your plan's limit ran out.")).toBeTruthy();
    expect(client.focus.current()).toEqual({ on: false });
  });

  it("hides the contents and the column; a margin marker opens only its card, and Esc closes it first", async () => {
    const client = await chat(true);
    const review: Review = {
      path: "specs/a.md",
      task: null,
      approvals: [],
      comments: [
        { id: "c1", author: "agent", kind: "question", anchor: { quote: "Filter by size.", heading: "scope", occurrence: 0 }, text: "Size only?", options: [{ label: "Keep", text: "Filter by size." }], state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" },
        { id: "c2", author: "agent", kind: "comment", anchor: { quote: "Filter", heading: "scope", occurrence: 0 }, text: "Name it.", state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" },
      ],
    };
    client.reviews["specs/a.md"] = review;
    const reader = await openReader();
    await within(reader).findByRole("region", { name: "Comments" });
    expect(within(reader).getByRole("navigation", { name: "Contents" })).toBeTruthy();
    fireEvent.click(within(reader).getByRole("button", { name: "Focus" }));
    expect(within(reader).queryByRole("region", { name: "Comments" })).toBeNull();
    expect(within(reader).queryByRole("navigation", { name: "Contents" })).toBeNull();
    expect(within(reader).queryByRole("button", { name: "Full screen" })).toBeNull();
    fireEvent.click(await within(reader).findByRole("button", { name: "Comment: Size only?" }));
    const column = within(reader).getByRole("region", { name: "Comments" });
    expect(within(column).getByText("Size only?")).toBeTruthy();
    expect(within(column).queryByText("Name it.")).toBeNull();
    fireEvent.keyDown(column, { key: "Escape" });
    expect(within(reader).queryByRole("region", { name: "Comments" })).toBeNull();
    expect(within(reader).getByRole("button", { name: "Leave focus" })).toBeTruthy();
  });

  it("client.documents.focus(path) opens the reader in focus mode", async () => {
    const client = await chat(true);
    await screen.findByText("I wrote the spec.");
    act(() => client.documents.focus("specs/a.md"));
    const reader = await screen.findByRole("complementary", { name: "Document" });
    expect(within(reader).getByRole("button", { name: "Leave focus" })).toBeTruthy();
  });

  it("without `review` there is no Focus button, and documents.focus does nothing (D0)", async () => {
    const client = await chat(false);
    const reader = await openReader();
    await within(reader).findByRole("heading", { name: "Scope" });
    expect(within(reader).queryByRole("button", { name: "Focus" })).toBeNull();
    fireEvent.click(within(reader).getByRole("button", { name: "Close" }));
    act(() => client.documents.focus("specs/a.md"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
  });
});
