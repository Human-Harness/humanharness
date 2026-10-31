// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessApp } from "../src";
import type { SearchAnswer, SearchHitView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

const MOD = /Mac/.test(navigator.userAgent) ? { metaKey: true } : { ctrlKey: true };
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const DOC: SearchHitView = {
  id: "file:folder/docs/guide.md",
  kind: "file",
  title: [{ text: "guide.md" }],
  context: [{ text: "the " }, { text: "context", mark: true }],
  hint: { kind: "path", text: "docs/guide.md" },
  target: { kind: "document", path: "docs/guide.md", anchor: "setup" },
};
const ANSWER: SearchAnswer = { ok: true, query: "guide", groups: [{ kind: "file", total: 1, hits: [DOC] }], counts: { task: 0, note: 0, file: 1 }, recent: [], partial: false, status: { state: "ready", done: 1, total: 1 }, allScopes: false };

function setup() {
  const client = new FakeClient(ready);
  client.searchAnswers.guide = ANSWER;
  client.docTexts["docs/guide.md"] = "# Guide\n\n## Setup\nsteps";
  return client;
}
async function startWork() {
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByPlaceholderText(/Write a message…/);
}

describe("search in the window (§5.1, §3)", () => {
  it("⌘K opens and closes the palette; focus goes back", async () => {
    render(<HarnessApp client={setup()} />);
    await startWork();
    const composer = screen.getByPlaceholderText(/Write a message…/);
    composer.focus();
    fireEvent.keyDown(window, { key: "k", ...MOD });
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    expect(document.activeElement).toBe(within(dialog).getByRole("combobox"));
    fireEvent.keyDown(window, { key: "k", ...MOD });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    expect(document.activeElement).toBe(composer);
  });

  it("a .md result opens in the reader; main is told it was opened", async () => {
    const client = setup();
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("guide"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.click(await within(dialog).findByRole("option"));
    expect(await screen.findByRole("complementary", { name: "Document" })).toBeTruthy();
    expect(client.searchOpened.map((h) => h.id)).toEqual([DOC.id]);
    expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull();
  });

  it("from Home, a result goes to the work screen first", async () => {
    const client = setup();
    render(<HarnessApp client={client} />);
    await screen.findByRole("button", { name: "Start Demo" });
    act(() => client.search.open("guide"));
    fireEvent.click(await within(await screen.findByRole("dialog", { name: "Search" })).findByRole("option"));
    expect(await screen.findByRole("complementary", { name: "Document" })).toBeTruthy();
  });

  it("⌘Enter fills the composer and sends nothing (D3)", async () => {
    const client = setup();
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("guide"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    await within(dialog).findByRole("option");
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Enter", ...MOD });
    const composer = (await screen.findByPlaceholderText(/Write a message…/)) as HTMLTextAreaElement;
    await waitFor(() => expect(composer.value).toBe("guide\n\nPossibly related: `docs/guide.md`."));
    expect(client.sent).toEqual([]);
  });

  it("a chat entry not on screen opens the History panel at its task", async () => {
    const client = setup();
    client.searchAnswers.old = { ...ANSWER, query: "old", groups: [{ kind: "task", total: 1, hits: [{ ...DOC, id: "chat:x#e1", kind: "task", hint: null, target: { kind: "chat", entry: "e1", scope: "main", task: "t1" } }] }], counts: { task: 1, note: 0, file: 0 } };
    render(<HarnessApp client={client} />);
    await startWork();
    act(() => client.search.open("old"));
    fireEvent.click(await within(await screen.findByRole("dialog", { name: "Search" })).findByRole("option"));
    expect(await screen.findByRole("heading", { name: "History" })).toBeTruthy();
  });
});
