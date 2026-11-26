// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModsView } from "../src/client";
import { ChatView } from "../src/ChatView";
import { Rail } from "../src/chrome";
import { type UiCtx, startModLoader } from "../src/layout/mod-loader";
import { type BlockRegistry, type TaskPageProps, ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";
import { FakeClient } from "./fake-client";
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

let seen: TaskPageProps | null = null;
const Page = (props: TaskPageProps) => {
  seen = props;
  return (
    <div>
      <p>Mod history page</p>
      <button type="button" onClick={props.onBack}>
        Back from mod
      </button>
    </div>
  );
};
const Boom = (): ReactNode => {
  throw new Error("boom");
};
const options = { name: "history", rail: { icon: "history", label: "Past work" }, title: "Past work title" } as const;

type Intent = { current: ((i: never) => boolean) | null };
type RailPick = { page: "notes" | "history"; n: number };

describe("ctx.taskPage (the slot)", () => {
  it("registers a page by name, once per mod; the disposer takes it away", async () => {
    const registry = createBlockRegistry();
    let off = () => {};
    await load(registry, (ctx) => {
      off = ctx.taskPage({ ...options, page: Page });
      expect(() => ctx.taskPage({ ...options, name: "other", page: Page })).toThrow(/once/);
    });
    const [entry] = registry.slot("taskPage");
    expect(entry).toMatchObject({ mod: "test", name: "history", rail: { icon: "history", label: "Past work" }, title: "Past work title", Page });
    expect(registry.slot("taskPage")).toHaveLength(1);
    off();
    expect(registry.slot("taskPage")).toHaveLength(0);
  });
});

describe("the task view hosts a registered page", () => {
  async function chat(registry: BlockRegistry, searchRef?: Intent) {
    const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
    const set = vi.fn(async (): Promise<ModsView> => ({ mods: [], problems: [] }));
    client.mods = { ...client.mods, set };
    const el = document.createElement("div");
    document.body.appendChild(el);
    const bar = { el, harness: "Demo", open: false, onHome: () => {}, switcher: <span>Task</span> };
    const view = (taskPage?: RailPick) => (
      <ModBlocksProvider registry={registry}>
        <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} bar={bar} {...(searchRef ? { searchRef: searchRef as never } : {})} {...(taskPage ? { taskPage } : {})} />
      </ModBlocksProvider>
    );
    const r = await renderIn("en", view());
    await screen.findByRole("textbox");
    return { client, set, rerender: (p: RailPick) => r.rerender(<I18nextProvider i18n={r.i18n}>{view(p)}</I18nextProvider>) };
  }

  it("the search history intent opens it with the props HistoryPage gets today, and Volver closes it", async () => {
    seen = null;
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.taskPage({ ...options, page: Page }));
    const searchRef: Intent = { current: null };
    const { client } = await chat(registry, searchRef);
    await act(async () => void searchRef.current?.({ kind: "history", task: "t-9" } as never));
    expect(await screen.findByText("Mod history page")).toBeTruthy();
    expect(seen).toMatchObject({ client, actions: client.state.actions, openTask: "t-9", disabled: false });
    for (const k of ["onBack", "onRestored", "onOpenFile"] as const) expect(typeof seen?.[k]).toBe("function");
    fireEvent.click(screen.getByRole("button", { name: "Back from mod" }));
    expect(screen.queryByText("Mod history page")).toBeNull();
  });

  it("the open-history command opens it, without a task", async () => {
    seen = null;
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.taskPage({ ...options, page: Page }));
    const searchRef: Intent = { current: null };
    await chat(registry, searchRef);
    await act(async () => void searchRef.current?.({ kind: "command", command: "open-history" } as never));
    expect(await screen.findByText("Mod history page")).toBeTruthy();
    expect((seen as TaskPageProps | null)?.openTask).toBeUndefined();
  });

  it("the rail's History pick opens it", async () => {
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.taskPage({ ...options, page: Page }));
    const { rerender } = await chat(registry);
    rerender({ page: "history", n: 1 });
    expect(await screen.findByText("Mod history page")).toBeTruthy();
  });

  it("a page that throws shows the failed part with Turn off", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.taskPage({ ...options, page: Boom }));
    const searchRef: Intent = { current: null };
    const { set } = await chat(registry, searchRef);
    await act(async () => void searchRef.current?.({ kind: "history", task: "t-9" } as never));
    fireEvent.click(within(await screen.findByRole("alert")).getByRole("button", { name: "Turn off" }));
    expect(set).toHaveBeenCalledWith("test", false);
  });

  it("with nothing registered the core's own History panel renders", async () => {
    const registry = createBlockRegistry();
    const searchRef: Intent = { current: null };
    await chat(registry, searchRef);
    await act(async () => void searchRef.current?.({ kind: "command", command: "open-history" } as never));
    expect(await screen.findByRole("heading", { name: "History" })).toBeTruthy();
    expect(screen.queryByText("Mod history page")).toBeNull();
  });
});

describe("the rail's task History entry", () => {
  it("takes its label and icon from the registered page, else as today", async () => {
    await renderIn("en", <Rail entries={["home", "task-history"]} current="home" onPick={() => {}} />);
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
    cleanup();
    await renderIn("en", <Rail entries={["home", "task-history"]} current="home" onPick={() => {}} taskPage={{ icon: "files", label: "Past work" }} />);
    expect(screen.getByRole("button", { name: "Past work" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
  });
});
