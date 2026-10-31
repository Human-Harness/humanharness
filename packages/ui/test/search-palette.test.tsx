// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchAnswer, SearchHitView } from "../src/client";
import { SearchPalette } from "../src/search/SearchPalette";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const MOD = /Mac/.test(navigator.userAgent) ? { metaKey: true } : { ctrlKey: true };
const hit = (id: string, kind: SearchHitView["kind"], title: string, o: Partial<SearchHitView> = {}): SearchHitView => ({ id, kind, title: [{ text: title }], context: [], hint: null, target: { kind: "timeline", path: title }, ...o });
const answer = (query: string, o: Partial<Extract<SearchAnswer, { ok: true }>> = {}): SearchAnswer => ({ ok: true, query, groups: [], counts: { task: 0, note: 0, file: 0 }, recent: [], partial: false, status: { state: "ready", done: 3, total: 3 }, allScopes: false, ...o });
const CONTEXT = answer("context", {
  groups: [
    { kind: "task", total: 1, hits: [hit("action:t", "task", "Topic 5", { meta: { status: "not-started", tier: "Deep" }, hint: { kind: "task", text: "Topic 5" }, target: { kind: "action", action: "t" } })] },
    { kind: "note", total: 1, hits: [hit("note:e", "note", "Engines", { hint: { kind: "note", text: "Engines" } })] },
    {
      kind: "file",
      total: 2,
      hits: [
        hit("file:g", "file", "guide.md", { context: [{ text: "the " }, { text: "context", mark: true }, { text: " window" }], hint: { kind: "path", text: "docs/guide.md" }, target: { kind: "document", path: "docs/guide.md", anchor: "context-window" } }),
        hit("file:r", "file", "spec.txt", { folder: "Docs", hint: { kind: "name", text: "spec.txt" }, target: { kind: "reveal" } }),
      ],
    },
  ],
  counts: { task: 1, note: 1, file: 2 },
});

async function show(props: Partial<Parameters<typeof SearchPalette>[0]> = {}) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.searchAnswers.context = CONTEXT;
  const onPick = vi.fn();
  const onAsk = vi.fn();
  const onClose = vi.fn();
  await renderIn("en", <SearchPalette client={client} where="Searching in Demo" references onClose={onClose} onPick={onPick} onAsk={onAsk} {...props} />);
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  const input = within(dialog).getByRole("combobox", { name: "Search tasks, notes and files" });
  return { client, dialog, input, onPick, onAsk, onClose };
}
const typeIn = async (dialog: HTMLElement, input: HTMLElement, value: string) => {
  fireEvent.change(input, { target: { value } });
  return within(dialog).findAllByRole("option");
};

describe("SearchPalette (§5)", () => {
  it("asks for the recents on open, then groups results with chips, counts and marks", async () => {
    const { client, dialog, input } = await show();
    await waitFor(() => expect(client.searchCalls[0]).toEqual({ query: "", filters: {} }));
    expect(document.activeElement).toBe(input);
    await typeIn(dialog, input, "context");
    const list = within(dialog).getByRole("listbox", { name: "Results" });
    expect(within(list).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Tasks", "Notes", "Files"]);
    expect(within(list).getAllByRole("option")).toHaveLength(4);
    expect(within(list).getByText("not started · Deep")).toBeTruthy();
    expect(within(list).getByText("Docs · read only")).toBeTruthy();
    expect(list.querySelector("mark")?.textContent).toBe("context");
    const chips = within(dialog).getByRole("group", { name: "Filters" });
    expect(within(chips).getAllByRole("button").map((b) => b.textContent)).toEqual(["All 4", "Tasks 1", "Notes 1", "Files 2"]);
    expect(screen.getByText("4 results")).toBeTruthy();
    expect(within(dialog).getByText("Searching in Demo")).toBeTruthy();
  });

  it("↑↓ move the active option; Enter opens it; a click opens too", async () => {
    const { dialog, input, onPick } = await show();
    await typeIn(dialog, input, "context");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const options = within(dialog).getAllByRole("option");
    expect(input.getAttribute("aria-activedescendant")).toBe(options[2].id);
    expect(options[2].getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "file:g" }));
    fireEvent.click(options[1]);
    expect(onPick).toHaveBeenLastCalledWith(expect.objectContaining({ id: "note:e" }));
  });

  it("⌘Enter prepares a question with up to three hints; with nothing typed it does nothing", async () => {
    const { dialog, input, onAsk } = await show();
    fireEvent.keyDown(input, { key: "Enter", ...MOD });
    expect(onAsk).not.toHaveBeenCalled();
    await typeIn(dialog, input, "context");
    fireEvent.keyDown(input, { key: "Enter", ...MOD });
    expect(onAsk).toHaveBeenCalledWith('context\n\nPossibly related: task "Topic 5", note "Engines", `docs/guide.md`.');
  });

  it("⌘2 picks the second chip, which asks again with its kind", async () => {
    const { client, dialog, input } = await show();
    await typeIn(dialog, input, "context");
    fireEvent.keyDown(input, { key: "2", ...MOD });
    await waitFor(() => expect(client.searchCalls.at(-1)).toEqual({ query: "context", filters: { kind: "task" } }));
  });

  it("says partial matches and indexing progress; Escape closes", async () => {
    const { client, dialog, input, onClose } = await show();
    client.searchAnswers.zebra = answer("zebra", { partial: true, status: { state: "building", done: 3, total: 10 }, groups: [{ kind: "note", total: 1, hits: [hit("note:z", "note", "Zebra")] }], counts: { task: 0, note: 1, file: 0 } });
    await typeIn(dialog, input, "zebra");
    expect(within(dialog).getByText("Showing partial matches")).toBeTruthy();
    expect(within(dialog).getByText("Indexing… 3 of 10")).toBeTruthy();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("the keys it handles stay in the palette: a modal under it (the Settings sheet's document listener) never sees them", async () => {
    const heard: string[] = [];
    const sheet = (e: KeyboardEvent) => heard.push(e.key);
    document.addEventListener("keydown", sheet);
    try {
      const { dialog, input, onPick } = await show();
      await typeIn(dialog, input, "context");
      for (const key of ["Tab", "ArrowDown", "ArrowUp", "Enter"]) fireEvent.keyDown(input, { key });
      fireEvent.keyDown(input, { key: "Enter", ...MOD });
      fireEvent.keyDown(input, { key: "2", ...MOD });
      expect(onPick).toHaveBeenCalled();
      expect(heard).toEqual([]);
      // What the palette doesn't handle still reaches the page.
      fireEvent.keyDown(input, { key: "a" });
      expect(heard).toEqual(["a"]);
    } finally {
      document.removeEventListener("keydown", sheet);
    }
  });

  it("says when search isn't ready, and when nothing matched", async () => {
    const { client, dialog, input } = await show();
    client.searchAnswers.x = { ok: false, reason: "not-ready" };
    fireEvent.change(input, { target: { value: "x" } });
    expect(await within(dialog).findByText("Search works once the app is set up.")).toBeTruthy();
    fireEvent.change(input, { target: { value: "nothing" } });
    expect(await within(dialog).findByText("Nothing found for “nothing”.")).toBeTruthy();
  });

  it("the scopes and reference folders toggles ask again", async () => {
    const { client, dialog } = await show({ scopesPlural: "topics" });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "All topics" }));
    await waitFor(() => expect(client.searchCalls.at(-1)?.filters).toEqual({ allScopes: true }));
    fireEvent.click(within(dialog).getByRole("checkbox", { name: "Reference folders" }));
    await waitFor(() => expect(client.searchCalls.at(-1)?.filters).toEqual({ allScopes: true, references: false }));
  });

  it("asks again when the index moves on, so what a build adds while it is open shows without typing (D8)", async () => {
    const { client, dialog, input } = await show();
    client.searchAnswers.context = answer("context", { groups: [CONTEXT.ok ? CONTEXT.groups[0] : { kind: "task", total: 0, hits: [] }], counts: { task: 1, note: 0, file: 0 }, status: { state: "names", done: 0, total: 2 } });
    await typeIn(dialog, input, "context");
    const list = within(dialog).getByRole("listbox", { name: "Results" });
    expect(within(list).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Tasks"]);
    client.searchAnswers.context = CONTEXT;
    client.searchStatusEmit({ state: "ready", done: 2, total: 2 });
    await waitFor(() => expect(within(list).getAllByRole("group").map((g) => g.getAttribute("aria-label"))).toEqual(["Tasks", "Notes", "Files"]));
    expect(client.searchCalls.at(-1)).toEqual({ query: "context", filters: {} });
  });
});
