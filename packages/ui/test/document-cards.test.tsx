// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../src/ChatView";
import type { ChatEntry } from "../src/client";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const card = { path: "tickets/MUS-412/analysis.md", title: "Analysis", kind: "analysis", change: "new" as const, words: 460 };
const answer = (documents?: ChatEntry["documents"]): ChatEntry => ({
  id: "a1",
  role: "assistant",
  text: "I wrote the analysis.",
  blocks: [],
  activities: [],
  at: "2026-10-27T10:00:00.000Z",
  engine: "claude",
  ...(documents ? { documents } : {}),
});

async function chatWith(entries: ChatEntry[], docs: Record<string, string> = {}) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.chat = entries;
  Object.assign(client.docTexts, docs);
  const exists = vi.spyOn(client, "documentsExist");
  await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />);
  return { client, exists };
}

describe("document cards (§5.1)", () => {
  it("a card per document with its title, kind, new or updated and reading time; it opens the reader", async () => {
    await chatWith([answer([card])], { [card.path]: "# Analysis\n\n## Context\n" });
    const button = await screen.findByRole("button", { name: /Analysis/ });
    expect(button.textContent).toContain("analysis");
    expect(button.textContent).toContain("New");
    expect(button.textContent).toContain("2 min read");
    fireEvent.click(button);
    const reader = await screen.findByRole("complementary", { name: "Document" });
    expect(await within(reader).findByRole("heading", { name: "Context" })).toBeTruthy();
    expect(within(reader).getByText("Written by Claude")).toBeTruthy();
  });

  it("an updated document says so", async () => {
    await chatWith([answer([{ ...card, change: "updated" }])], { [card.path]: "# A" });
    const button = await screen.findByRole("button", { name: /Analysis/ });
    expect(button.textContent).toContain("Updated");
  });

  it("a moved or deleted document's card is struck through and does nothing", async () => {
    await chatWith([answer([card])]);
    const button = await screen.findByRole("button", { name: /Analysis/ });
    await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    expect(button.className).toContain("hh-doc-card-missing");
    fireEvent.click(button);
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
  });

  it("D0: no cards, no existence check, no panel", async () => {
    const { exists } = await chatWith([answer()]);
    await screen.findByText("I wrote the analysis.");
    expect(exists).not.toHaveBeenCalled();
    expect(document.querySelector(".hh-doc-cards")).toBeNull();
    expect(document.querySelector(".hh-with-reader")).toBeNull();
  });

  it("a malformed chat file draws only its well-formed cards and never crashes", async () => {
    const bad = [
      card,
      { path: 42, title: "Number path", change: "new", words: 1 },
      { path: "/etc/passwd.md", title: "Absolute", change: "new", words: 1 },
      { path: "x.md", title: "Bad change", change: "deleted", words: 1 },
    ] as unknown as ChatEntry["documents"];
    const { exists } = await chatWith([answer(bad), { ...answer("nope" as unknown as ChatEntry["documents"]), id: "a2", text: "Second." }], {
      [card.path]: "# A",
    });
    await screen.findByText("Second.");
    expect(screen.getAllByRole("button", { name: /Analysis|Number|Absolute|Bad change/ }).map((b) => b.textContent)).toHaveLength(1);
    await vi.waitFor(() => expect(exists).toHaveBeenCalledWith([card.path]));
  });

  it("client.openDocument opens the panel; full screen hides the chat; a .md link in the chat opens the reader", async () => {
    const { client } = await chatWith([{ ...answer(), text: "See [the plan](docs/plan.md)." }], { "docs/plan.md": "# Plan", "x.md": "# X" });
    await screen.findByRole("link", { name: "the plan" });
    act(() => client.openDocument("x.md"));
    const reader = await screen.findByRole("complementary", { name: "Document" });
    expect(await within(reader).findByRole("heading", { name: "X" })).toBeTruthy();
    expect(document.querySelector(".hh-body.hh-with-reader")).not.toBeNull();
    fireEvent.click(within(reader).getByRole("button", { name: "Full screen" }));
    expect(document.querySelector(".hh-body.hh-reader-full")).not.toBeNull();
    fireEvent.click(within(reader).getByRole("button", { name: "Show chat" }));
    expect(document.querySelector(".hh-body.hh-reader-full")).toBeNull();
    fireEvent.click(screen.getByRole("link", { name: "the plan" }));
    const again = await screen.findByRole("complementary", { name: "Document" });
    expect(await within(again).findByRole("heading", { name: "Plan" })).toBeTruthy();
  });

  it("openDocument with an anchor opens the reader there; an anchor that is not a string is ignored", async () => {
    const ids: string[] = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      ids.push(this.id);
    };
    const { client } = await chatWith([answer()], { "x.md": "# X\n\n## Intro\n\nText.\n\n## Risks\n\nMore." });
    await screen.findByText("I wrote the analysis.");
    act(() => client.openDocument("x.md", "risks"));
    const reader = await screen.findByRole("complementary", { name: "Document" });
    expect(await within(reader).findByRole("heading", { name: "Risks" })).toBeTruthy();
    await vi.waitFor(() => expect(ids.some((id) => id.endsWith("risks"))).toBe(true));
    ids.length = 0;
    act(() => client.openDocument("x.md", 7 as unknown as string));
    await new Promise((r) => setTimeout(r, 50));
    expect(ids.some((id) => id.endsWith("risks"))).toBe(false);
    expect(within(reader).getByRole("heading", { name: "X" })).toBeTruthy();
  });

  it("openDocument from a harness's UI with a non-string path opens nothing", async () => {
    const { client } = await chatWith([answer()]);
    await screen.findByText("I wrote the analysis.");
    act(() => client.openDocument(42 as unknown as string));
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
  });

  it("Close shuts the panel and gives the composer focus", async () => {
    const { client } = await chatWith([answer()], { "x.md": "# X" });
    await screen.findByText("I wrote the analysis.");
    act(() => client.openDocument("x.md"));
    const reader = await screen.findByRole("complementary", { name: "Document" });
    fireEvent.click(within(reader).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
    expect(document.activeElement?.tagName).toBe("TEXTAREA");
  });

  it("closing from full screen gives focus back to the card that opened the reader", async () => {
    await chatWith([answer([card])], { [card.path]: "# A" });
    const button = await screen.findByRole("button", { name: /Analysis/ });
    await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBeNull());
    button.focus();
    fireEvent.click(button);
    const reader = await screen.findByRole("complementary", { name: "Document" });
    await within(reader).findByRole("heading", { name: "A" });
    fireEvent.click(within(reader).getByRole("button", { name: "Full screen" }));
    fireEvent.click(within(reader).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
    expect(document.querySelector(".hh-reader-full")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("the cards are checked again when the reader finds a document gone, and when the window gets focus", async () => {
    const { client, exists } = await chatWith([answer([card])], { [card.path]: "# A" });
    const button = await screen.findByRole("button", { name: /Analysis/ });
    await vi.waitFor(() => expect(exists).toHaveBeenCalledTimes(1));
    expect(button.getAttribute("aria-disabled")).toBeNull();
    delete client.docTexts[card.path];
    fireEvent.click(button);
    const reader = await screen.findByRole("complementary", { name: "Document" });
    await within(reader).findByText("This document was moved or deleted.");
    await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    client.docTexts[card.path] = "# A";
    act(() => void window.dispatchEvent(new Event("focus")));
    await vi.waitFor(() => expect(button.getAttribute("aria-disabled")).toBeNull());
  });

  it("slim (the setup screen): nothing opens the reader", async () => {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.chat = [answer()];
    client.docTexts["x.md"] = "# X";
    await renderIn("en", <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} slim={{ action: "interview" }} />);
    act(() => client.openDocument("x.md"));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole("complementary", { name: "Document" })).toBeNull();
    expect(document.querySelector(".hh-with-reader")).toBeNull();
  });

  it("reading preferences are saved with the app config", async () => {
    const { client } = await chatWith([answer([card])], { [card.path]: "# A" });
    const save = vi.spyOn(client, "saveConfig");
    fireEvent.click(await screen.findByRole("button", { name: /Analysis/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Aa reading preferences" }));
    fireEvent.click(screen.getByRole("button", { name: "Large" }));
    expect(save).toHaveBeenCalledWith({ reader: { font: "sans", size: "large" } });
  });
});
