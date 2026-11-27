// @vitest-environment happy-dom
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../src/ChatView";
import type { ChatEntry, HistoryTaskView, ModsView } from "../src/client";
import type { SearchIntent } from "../src/search/intent";
import { type UiCtx, startModLoader } from "../src/layout/mod-loader";
import { type BlockRegistry, type FileTarget, ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";
import { FakeClient } from "./fake-client";
import { historyViewRegistry } from "./history-view";
import { renderIn } from "./render";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function load(registry: BlockRegistry, ui: (ctx: UiCtx) => void, id = "test") {
  const mods = {
    view: async (): Promise<ModsView> => ({ mods: [], problems: [] }),
    onChanged: () => () => {},
    onReloaded: () => () => {},
    call: async () => undefined,
    on: () => () => {},
  };
  const loader = startModLoader({ client: { mods }, registry, core: [{ id, ui }] });
  await loader.settled();
  return loader;
}

const card = { path: "specs/a.md", title: "Filter", kind: "spec", change: "new" as const, words: 120 };
const answer: ChatEntry = {
  id: "a1",
  role: "assistant",
  text: "See [the plan](specs/plan.md#scope) and [all of it](specs/all.md).",
  blocks: [],
  activities: [],
  at: "2026-10-28T10:00:00.000Z",
  engine: "claude",
  documents: [card],
};
const groups: HistoryTaskView[] = [
  {
    taskId: "t1",
    actionId: null,
    start: "s0",
    end: "e1",
    date: "2026-10-28T10:00:00.000Z",
    changes: [
      { path: "kept.md", kind: "modified" },
      { path: "old.md", kind: "deleted" },
      { path: "data.json", kind: "added" },
    ],
    entries: [{ sha: "e1", message: "Turn: write", date: "2026-10-28T10:00:00.000Z" }],
  },
];

async function chat(registry: BlockRegistry) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.chat = [answer];
  client.docTexts[card.path] = "## Scope\n";
  client.docTexts["specs/plan.md"] = "## Scope\n";
  client.historyGroups = groups;
  client.state.review = true;
  const searchRef: { current: ((i: SearchIntent) => boolean) | null } = { current: null };
  await renderIn(
    "en",
    <ModBlocksProvider registry={registry}>
      <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} searchRef={searchRef} />
    </ModBlocksProvider>,
    { theme: true },
  );
  await screen.findByText(/See/);
  const search = (i: SearchIntent) => {
    let handled = false;
    act(() => void (handled = searchRef.current!(i)));
    return handled;
  };
  return { client, search };
}

const reader = () => screen.queryByRole("complementary", { name: "Document" });

describe("ctx.openFile", () => {
  it("holds one handler: a second registration replaces it and its disposer gives the first back", async () => {
    const registry = createBlockRegistry();
    const first: string[] = [];
    const second: string[] = [];
    let off = () => {};
    await load(registry, (ctx) => {
      ctx.openFile((t) => first.push(t.path));
      off = ctx.openFile((t) => second.push(t.path));
    });
    const { client } = await chat(registry);
    act(() => client.openDocument("one.md"));
    act(off);
    act(() => client.openDocument("two.md"));
    expect(second).toEqual(["one.md"]);
    expect(first).toEqual(["two.md"]);
    expect(reader()).toBeNull();
  });

  it("a mod that goes off takes its handler away: the core reader opens again", async () => {
    const registry = createBlockRegistry();
    const seen: FileTarget[] = [];
    const loader = await load(registry, (ctx) => void ctx.openFile((t) => seen.push(t)));
    const { client } = await chat(registry);
    act(() => loader.stop());
    act(() => client.openDocument("specs/plan.md"));
    expect(await screen.findByRole("complementary", { name: "Document" })).toBeTruthy();
    expect(seen).toEqual([]);
  });

  it("every opener calls it with the target it builds today", async () => {
    const registry = historyViewRegistry();
    const seen: FileTarget[] = [];
    await load(registry, (ctx) => void ctx.openFile((t) => seen.push(t)));
    const { client, search } = await chat(registry);
    const last = () => seen.at(-1);

    fireEvent.click(screen.getByRole("link", { name: "the plan" }));
    expect(last()).toStrictEqual({ path: "specs/plan.md", anchor: "scope" });
    fireEvent.click(screen.getByRole("link", { name: "all of it" }));
    expect(last()).toStrictEqual({ path: "specs/all.md" });

    fireEvent.click(screen.getByRole("button", { name: /Filter/ }));
    expect(last()).toStrictEqual({ path: "specs/a.md", agent: "Claude" });

    act(() => client.openDocument("notes/b.md", "part"));
    expect(last()).toStrictEqual({ path: "notes/b.md", anchor: "part" });

    act(() => client.documents.focus("specs/a.md"));
    expect(last()).toStrictEqual({ path: "specs/a.md" });
    // The focus that came with it is the task view's, as today.
    expect(client.focus.current()).toEqual({ on: true, path: "specs/a.md" });

    for (const [name, target] of [
      ["kept.md", { path: "kept.md", timeline: true }],
      ["old.md", { path: "old.md", historyOnly: true }],
      ["data.json", { path: "data.json", historyOnly: true }],
    ] as const) {
      expect(search({ kind: "command", command: "open-history" } as SearchIntent)).toBe(true);
      const files = await screen.findByRole("list", { name: "Changed files" });
      fireEvent.click(within(files).getByRole("button", { name: new RegExp(name.replace(".", "\\.")) }));
      expect(last()).toStrictEqual(target);
    }

    expect(search({ kind: "document", path: "specs/c.md", anchor: "x" } as SearchIntent)).toBe(true);
    expect(last()).toStrictEqual({ path: "specs/c.md", anchor: "x" });
    expect(search({ kind: "timeline", path: "data.json" } as SearchIntent)).toBe(true);
    expect(last()).toStrictEqual({ path: "data.json", historyOnly: true });

    expect(reader()).toBeNull();
    expect(document.querySelector("section.hh-split")).toBeNull();
  });

  it("a handler that throws is logged and the chat stays", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = createBlockRegistry();
    await load(registry, (ctx) => {
      ctx.openFile(() => {
        throw new Error("boom");
      });
    });
    const { client } = await chat(registry);
    act(() => client.openDocument("one.md"));
    expect(error).toHaveBeenCalled();
    expect(screen.getByText(/See/)).toBeTruthy();
  });

  it("with no handler, .md links are plain text, cards do nothing and nothing opens", async () => {
    const registry = historyViewRegistry(createBlockRegistry({ coreOpener: false }));
    const { client, search } = await chat(registry);
    expect(screen.queryByRole("link", { name: "the plan" })).toBeNull();
    expect(document.querySelector(".hh-md-doclink")).toBeNull();
    const button = screen.getByRole("button", { name: /Filter/ });
    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(button.className).not.toContain("hh-doc-card-missing");
    fireEvent.click(button);
    act(() => client.openDocument("specs/plan.md"));
    act(() => client.documents.focus("specs/a.md"));
    expect(search({ kind: "document", path: "specs/a.md" } as SearchIntent)).toBe(false);
    expect(search({ kind: "timeline", path: "data.json" } as SearchIntent)).toBe(false);
    expect(reader()).toBeNull();
    expect(document.querySelector("section.hh-split")).toBeNull();
    expect(document.querySelector(".hh-with-reader")).toBeNull();
    expect(client.focus.current()).toEqual({ on: false });
  });
});
