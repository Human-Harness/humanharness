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
    expect(await screen.findAllByText("While you were reading: your plan's limit ran out.")).not.toHaveLength(0);
    expect(client.focus.current()).toEqual({ on: false });
  });

  it("Esc leaves focus mode even when focus fell to the page (the button pressed went away)", async () => {
    const client = await chat(true);
    const reader = await openReader();
    fireEvent.click(within(reader).getByRole("button", { name: "Focus" }));
    expect(document.querySelector(".hh-focus")).not.toBeNull();
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(document.querySelector(".hh-focus")).toBeNull();
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

  it("counts the task waiting after the turn's end (afterRun sets it after `done`), and says it out loud on leaving", async () => {
    const client = await chat(true);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Go on" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    const reader = await openReader();
    fireEvent.click(within(reader).getByRole("button", { name: "Focus" }));
    act(() => client.emit({ type: "done", ok: true }));
    act(() => client.emitTasks({ current: { id: "t1", status: "waiting" }, actions: {}, notes: [] }));
    fireEvent.click(within(reader).getByRole("button", { name: "Leave focus" }));
    const line = "While you were reading: the task is waiting for you.";
    expect(await screen.findAllByText(line)).not.toHaveLength(0);
    expect(document.querySelector("[aria-live='polite']")?.textContent).toBe(line);
  });

  it("counts a phase proposal made while in focus", async () => {
    const client = await chat(true);
    const reader = await openReader();
    fireEvent.click(within(reader).getByRole("button", { name: "Focus" }));
    act(() => client.emitTasks({ current: { id: "t1", status: "running", phaseProposal: { to: "build", reason: "Spec done" } }, actions: {}, notes: [] }));
    fireEvent.click(within(reader).getByRole("button", { name: "Leave focus" }));
    expect(await screen.findAllByText("While you were reading: the AI proposed to move to another part.")).not.toHaveLength(0);
  });

  it("counts nothing outside focus mode", async () => {
    const client = await chat(true);
    const reader = await openReader();
    act(() => client.emitTasks({ current: { id: "t1", status: "waiting", phaseProposal: { to: "build", reason: "Spec done" } }, actions: {}, notes: [] }));
    fireEvent.click(within(reader).getByRole("button", { name: "Focus" }));
    fireEvent.click(within(reader).getByRole("button", { name: "Leave focus" }));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByText(/While you were reading/)).toBeNull();
  });

  it("Esc on a peeked card puts focus back on its marker, which says it is expanded", async () => {
    const client = await chat(true);
    client.reviews["specs/a.md"] = {
      path: "specs/a.md",
      task: null,
      approvals: [],
      comments: [{ id: "c2", author: "agent", kind: "comment", anchor: { quote: "Filter", heading: "scope", occurrence: 0 }, text: "Name it.", state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" }],
    };
    const reader = await openReader();
    await within(reader).findByRole("region", { name: "Comments" });
    fireEvent.click(within(reader).getByRole("button", { name: "Focus" }));
    const marker = await within(reader).findByRole("button", { name: "Comment: Name it." });
    expect(marker.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(marker);
    expect(marker.getAttribute("aria-expanded")).toBe("true");
    const column = within(reader).getByRole("region", { name: "Comments" });
    const inside = column.querySelector<HTMLElement>("[tabindex], button") ?? column;
    inside.focus();
    fireEvent.keyDown(inside, { key: "Escape" });
    expect(within(reader).queryByRole("region", { name: "Comments" })).toBeNull();
    expect(document.activeElement).toBe(marker);
    expect(marker.getAttribute("aria-expanded")).toBe("false");
  });

  it("a reason being written survives a switch of mode, and Esc in it closes only the prompt", async () => {
    const client = await chat(true);
    client.reviews["specs/a.md"] = {
      path: "specs/a.md",
      task: null,
      approvals: [],
      comments: [{ id: "c1", author: "agent", kind: "question", blocking: true, anchor: { quote: "Filter by size.", heading: "scope", occurrence: 0 }, text: "Size only?", options: [{ label: "Keep", text: "Filter by size." }], state: "open", replies: [], at: "2026-10-28T10:00:00.000Z" }],
    };
    const reader = await openReader();
    fireEvent.click(await within(reader).findByRole("button", { name: /Approve · 1 blocking open/ }));
    fireEvent.click(within(reader).getByRole("button", { name: "Approve anyway, with a reason" }));
    fireEvent.change(within(reader).getByRole("textbox", { name: "Why approve with blocking questions open?" }), { target: { value: "Decided on the call" } });
    fireEvent.click(within(reader).getByRole("button", { name: "Focus" }));
    const box = within(reader).getByRole("textbox", { name: "Why approve with blocking questions open?" }) as HTMLTextAreaElement;
    expect(box.value).toBe("Decided on the call");
    fireEvent.keyDown(box, { key: "Escape" });
    expect(within(reader).queryByRole("textbox", { name: "Why approve with blocking questions open?" })).toBeNull();
    expect(within(reader).getByRole("button", { name: "Leave focus" })).toBeTruthy();
    expect(document.activeElement).toBe(within(reader).getByRole("button", { name: /Approve · 1 blocking open/ }));
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
