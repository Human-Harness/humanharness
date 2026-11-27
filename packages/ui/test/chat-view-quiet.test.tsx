// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatView } from "../src/ChatView";
import type { ChatEntry, ModsView } from "../src/client";
import type { SearchIntent } from "../src/search/intent";
import { type UiCtx, startModLoader } from "../src/layout/mod-loader";
import { type BlockRegistry, type PanelProps, ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const answer: ChatEntry = { id: "a1", role: "assistant", text: "I wrote the spec.", blocks: [], activities: [], at: "2026-10-28T10:00:00.000Z", engine: "claude" };

let seen: PanelProps | null = null;
function Panel(p: PanelProps) {
  seen = p;
  return (
    <aside className="hh-reader" aria-label="Mod panel">
      <p>{String((p.props as { path?: string } | undefined)?.path)}</p>
      <button type="button" onClick={p.onClose}>
        Close the panel
      </button>
    </aside>
  );
}
const Boom = (): ReactNode => {
  throw new Error("boom");
};

/** A mod that opens its panel for every file, and the ways the test drives it. */
async function load(registry: BlockRegistry, component: unknown = Panel, id = "viewer") {
  const mods = {
    view: async (): Promise<ModsView> => ({ mods: [], problems: [] }),
    onChanged: () => () => {},
    onReloaded: () => () => {},
    call: async () => undefined,
    on: () => () => {},
  };
  let ctx!: UiCtx;
  let panel!: ReturnType<UiCtx["panel"]>;
  const loader = startModLoader({
    client: { mods },
    registry,
    core: [
      {
        id,
        ui: (c) => {
          ctx = c;
          panel = c.panel(component);
          c.openFile((t) => panel.open(t));
        },
      },
    ],
  });
  await loader.settled();
  return { loader, quiet: (on: boolean) => act(() => ctx.taskView.quiet(on)), panel: () => panel };
}

async function chat(registry: BlockRegistry) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  client.chat = [answer];
  await renderIn(
    "en",
    <ModBlocksProvider registry={registry}>
      <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />
    </ModBlocksProvider>,
  );
  await screen.findByText("I wrote the spec.");
  return client;
}

const body = () => document.querySelector(".hh-body")!;
const live = () => document.querySelector("[aria-live='polite']")?.textContent;
const modPanel = () => screen.queryByRole("complementary", { name: "Mod panel" });

describe("ctx.panel (the reader's slot)", () => {
  it("draws the panel in the reader's slot, with the reader's classes, and gives focus back when it closes", async () => {
    const registry = createBlockRegistry();
    await load(registry);
    const client = await chat(registry);
    const composer = screen.getByRole("textbox");
    composer.focus();
    act(() => client.openDocument("specs/a.md"));
    expect(within(modPanel()!).getByText("specs/a.md")).toBeTruthy();
    expect(body().classList.contains("hh-with-reader")).toBe(true);
    expect(body().classList.contains("hh-reader-full")).toBe(false);
    act(() => seen!.onFull(true));
    expect(body().classList.contains("hh-reader-full")).toBe(true);
    screen.getByRole("button", { name: "Close the panel" }).focus();
    fireEvent.click(screen.getByRole("button", { name: "Close the panel" }));
    expect(modPanel()).toBeNull();
    expect(body().className).toBe("hh-body");
    expect(document.activeElement).toBe(composer);
  });

  it("opening again keeps the panel mounted and gives it the new props", async () => {
    const registry = createBlockRegistry();
    await load(registry);
    const client = await chat(registry);
    act(() => client.openDocument("a.md"));
    const first = modPanel();
    act(() => client.openDocument("b.md"));
    expect(modPanel()).toBe(first);
    expect(within(first!).getByText("b.md")).toBeTruthy();
    expect(registry.slot("openPanel")).toHaveLength(1);
  });

  it("holds one thing at a time: a mod's panel takes the slot from another mod's", async () => {
    const registry = createBlockRegistry();
    const one = await load(registry, Panel, "one");
    const two = await load(registry, Panel, "two");
    await chat(registry);
    act(() => one.panel().open({ path: "one" }));
    act(() => two.panel().open({ path: "two" }));
    expect(registry.slot("openPanel").map((e) => e.mod)).toEqual(["two"]);
    expect(screen.getAllByRole("complementary", { name: "Mod panel" })).toHaveLength(1);
    act(() => one.panel().close());
    expect(within(modPanel()!).getByText("two")).toBeTruthy();
    act(() => two.panel().close());
    expect(modPanel()).toBeNull();
  });

  it("a handle's close() closes its own panel only, not the one that replaced it", async () => {
    const registry = createBlockRegistry();
    let ctx!: UiCtx;
    await startModLoader({
      client: { mods: { view: async () => ({ mods: [], problems: [] }), onChanged: () => () => {}, onReloaded: () => () => {}, call: async () => undefined, on: () => () => {} } },
      registry,
      core: [{ id: "viewer", ui: (c) => void (ctx = c) }],
    }).settled();
    const a = ctx.panel(Panel);
    const b = ctx.panel(Panel);
    await chat(registry);
    act(() => a.open({ path: "a" }));
    act(() => b.open({ path: "b" }));
    act(() => a.close());
    expect(within(modPanel()!).getByText("b")).toBeTruthy();
    // Opened again through the first handle, the panel is that handle's.
    act(() => a.open({ path: "a again" }));
    act(() => b.close());
    expect(within(modPanel()!).getByText("a again")).toBeTruthy();
    act(() => a.close());
    expect(modPanel()).toBeNull();
    expect(registry.slot("openPanel")).toHaveLength(0);
  });

  it("closes when the chat takes the slot back (a new question)", async () => {
    const registry = createBlockRegistry();
    await load(registry);
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.chat = [answer];
    const searchRef: { current: ((i: SearchIntent) => boolean) | null } = { current: null };
    await renderIn(
      "en",
      <ModBlocksProvider registry={registry}>
        <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} searchRef={searchRef} />
      </ModBlocksProvider>,
    );
    act(() => client.openDocument("a.md"));
    expect(modPanel()).not.toBeNull();
    await act(async () => void searchRef.current?.({ kind: "command", command: "new-question" } as SearchIntent));
    expect(modPanel()).toBeNull();
    expect(registry.slot("openPanel")).toHaveLength(0);
  });

  it("a panel that throws shows the failed part, naming its mod", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = createBlockRegistry();
    await load(registry, Boom);
    const client = await chat(registry);
    const set = vi.spyOn(client.mods, "set");
    act(() => client.openDocument("a.md"));
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Turn off" }));
    expect(set).toHaveBeenCalledWith("viewer", false);
  });

  it("goes away with its mod", async () => {
    const registry = createBlockRegistry();
    const mod = await load(registry);
    const client = await chat(registry);
    act(() => client.openDocument("a.md"));
    mod.quiet(true);
    act(() => mod.loader.stop());
    expect(modPanel()).toBeNull();
    expect(body().className).toBe("hh-body");
    expect(registry.slot("quiet")).toHaveLength(0);
  });
});

describe("ctx.taskView.quiet", () => {
  it("hides the chat and side panels, holds the composer focus and the live region, and prints the summary on leave", async () => {
    const registry = createBlockRegistry();
    const mod = await load(registry);
    const client = await chat(registry);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Go on" } });
    fireEvent.keyDown(document.querySelector(".hh-composer textarea")!, { key: "Enter" });
    act(() => client.openDocument("a.md"));
    mod.quiet(true);
    expect(body().classList.contains("hh-focus")).toBe(true);
    expect(seen!.quiet).toBe(true);
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    act(() => client.emit({ type: "done", ok: false, error: { code: "out-of-quota" } }));
    expect(document.activeElement?.tagName).not.toBe("TEXTAREA");
    expect(live()).toBe("");
    act(() => client.emitTasks({ current: { id: "t1", status: "waiting" }, actions: {}, notes: [] }));
    mod.quiet(false);
    expect(body().classList.contains("hh-focus")).toBe(false);
    expect(seen!.quiet).toBe(false);
    const line = "While you were reading: the task is waiting for you, your plan's limit ran out.";
    expect(await screen.findAllByText(line)).not.toHaveLength(0);
    expect(live()).toBe(line);
  });

  it("ends when the panel closes", async () => {
    const registry = createBlockRegistry();
    const mod = await load(registry);
    const client = await chat(registry);
    act(() => client.openDocument("a.md"));
    mod.quiet(true);
    act(() => client.emitTasks({ current: { id: "t1", status: "waiting" }, actions: {}, notes: [] }));
    fireEvent.click(screen.getByRole("button", { name: "Close the panel" }));
    expect(registry.slot("quiet")).toHaveLength(0);
    expect(await screen.findAllByText("While you were reading: the task is waiting for you.")).not.toHaveLength(0);
    expect(client.focus.current()).toEqual({ on: false });
  });

  it("hides nothing with an empty slot", async () => {
    const registry = createBlockRegistry();
    const mod = await load(registry);
    await chat(registry);
    mod.quiet(true);
    expect(body().classList.contains("hh-focus")).toBe(false);
    mod.quiet(false);
    expect(screen.queryByText(/^While you were reading/)).toBeNull();
  });

  const view = (registry: BlockRegistry, client: FakeClient, key: string) => (
    <ModBlocksProvider registry={registry}>
      <button type="button">Outside</button>
      <ChatView key={key} client={client} state={client.state} components={{}} stateBlocks={[]} />
    </ModBlocksProvider>
  );
  const expectNothingLeft = (registry: BlockRegistry) => {
    expect(registry.slot("openPanel")).toHaveLength(0);
    expect(registry.slot("quiet")).toHaveLength(0);
    expect(modPanel()).toBeNull();
    expect(body().className).toBe("hh-body");
  };

  it("a mod's panel and quiet mode go with the chat: the next one starts with neither", async () => {
    const registry = createBlockRegistry();
    const mod = await load(registry);
    const client = await chat(registry);
    act(() => client.openDocument("a.md"));
    mod.quiet(true);
    cleanup();
    expect(registry.slot("openPanel")).toHaveLength(0);
    expect(registry.slot("quiet")).toHaveLength(0);
    await chat(registry);
    expectNothingLeft(registry);
  });

  it("a remount by key (another task or scope) drops them too, with no summary and no focus moved", async () => {
    const registry = createBlockRegistry();
    const mod = await load(registry);
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.chat = [answer];
    const { i18n, rerender } = await renderIn("en", view(registry, client, "one"));
    await screen.findByText("I wrote the spec.");
    act(() => client.openDocument("a.md"));
    mod.quiet(true);
    act(() => client.emitTasks({ current: { id: "t1", status: "waiting" }, actions: {}, notes: [] }));
    const push = vi.spyOn(client.focus, "set");
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    await act(async () => rerender(<I18nextProvider i18n={i18n}>{view(registry, client, "two")}</I18nextProvider>));
    await screen.findByText("I wrote the spec.");
    expectNothingLeft(registry);
    expect(screen.queryByText(/^While you were reading/)).toBeNull();
    expect(push).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outside);
  });

  it("leaves no core quiet behind when the chat goes away", async () => {
    const registry = createBlockRegistry();
    await load(registry);
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    client.chat = [answer];
    client.state.review = true;
    await renderIn(
      "en",
      <ModBlocksProvider registry={registry}>
        <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} />
      </ModBlocksProvider>,
    );
    act(() => client.documents.focus("a.md"));
    expect(registry.slot("quiet")).toHaveLength(1);
    cleanup();
    expect(registry.slot("quiet")).toHaveLength(0);
  });
});
