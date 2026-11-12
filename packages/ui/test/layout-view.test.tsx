// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Layout, ModsView } from "../src/client";
import { type AppValue, AppProvider } from "../src/layout/app";
import { LayoutView } from "../src/layout/LayoutView";
import { type BlockProps, ModBlocksProvider, createBlockRegistry, registerBlock, blockFor } from "../src/layout/registry";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

afterEach(cleanup);

const view = (on: boolean): ModsView => ({
  mods: [{ id: "notes", name: "Notes", version: "0.1.0", origin: "core", on, registers: { hooks: [], ipc: [] } }],
  problems: [],
});

function setup(mods: ModsView = { mods: [], problems: [] }) {
  const client = new FakeClient({ language: "en", folder: "/Users/me/Documents/Demo", engineId: "claude" });
  const set = vi.fn(async (_id: string, on: boolean): Promise<ModsView> => view(on));
  client.mods = { ...client.mods, view: vi.fn(async () => mods), set };
  const registry = createBlockRegistry();
  const app = { client } as unknown as AppValue;
  const wrap = (ui: ReactNode) => (
    <AppProvider value={app}>
      <ModBlocksProvider registry={registry}>{ui}</ModBlocksProvider>
    </AppProvider>
  );
  return { client, set, registry, app, wrap };
}

const block = (id: string, mod: string, name: string, props?: Record<string, unknown>): Layout => ({ type: "block", id, content: { mod, block: name, ...(props ? { props } : {}) } });
const task: Layout = { type: "block", id: "work", content: { core: "task" } };
const Label = ({ props }: BlockProps) => <p>{String(props.text)}</p>;

describe("LayoutView", () => {
  it("draws a row and a column as flex containers with their sizes", async () => {
    const { registry, wrap } = setup();
    registry.register("m", "label", Label);
    const layout: Layout = {
      type: "stack",
      children: [
        {
          type: "row",
          id: "home",
          children: [
            { ...block("left", "m", "label", { text: "Left" }), size: { px: 240 }, min: 200, max: 300 },
            { type: "column", id: "right", size: { weight: 2 }, children: [block("top", "m", "label", { text: "Top" }), block("bottom", "m", "label", { text: "Bottom" })] },
          ],
        },
        task,
      ],
    };
    await renderIn("en", wrap(<LayoutView layout={layout} shown="home" task={() => null} />), { theme: true });
    const row = document.querySelector<HTMLElement>('[data-layout="row"]')!;
    const column = document.querySelector<HTMLElement>('[data-layout="column"]')!;
    expect(row.className).toMatch(/rt-r-fd-row/);
    expect(column.className).toMatch(/rt-r-fd-column/);
    const left = document.querySelector<HTMLElement>('[data-layout-id="left"]')!;
    expect(left.style.getPropertyValue("--flex-basis")).toBe("240px");
    expect(left.style.getPropertyValue("--min-width")).toBe("200px");
    expect(left.style.getPropertyValue("--max-width")).toBe("300px");
    expect(column.style.getPropertyValue("--flex-grow")).toBe("2");
    expect(screen.getByText("Left")).toBeTruthy();
    expect(screen.getByText("Top")).toBeTruthy();
    expect(screen.getByText("Bottom")).toBeTruthy();
    // In a column, min and max are heights.
    cleanup();
    const col: Layout = { type: "stack", children: [{ type: "column", id: "home", children: [{ ...block("a", "m", "label", { text: "A" }), min: 100, max: 400 }] }, task] };
    await renderIn("en", wrap(<LayoutView layout={col} shown="home" task={() => null} />), { theme: true });
    const a = document.querySelector<HTMLElement>('[data-layout-id="a"]')!;
    expect(a.style.getPropertyValue("--min-height")).toBe("100px");
    expect(a.style.getPropertyValue("--max-height")).toBe("400px");
  });

  it("gives a block its props and the app", async () => {
    const { registry, wrap, app } = setup();
    const seen = vi.fn();
    registry.register("m", "spy", (p: BlockProps) => {
      seen(p);
      return <p>spy</p>;
    });
    const layout: Layout = { type: "stack", children: [block("home", "m", "spy", { n: 1 }), task] };
    await renderIn("en", wrap(<LayoutView layout={layout} shown="home" task={() => null} />), { theme: true });
    expect(await screen.findByText("spy")).toBeTruthy();
    expect(seen).toHaveBeenCalledWith(expect.objectContaining({ props: { n: 1 }, app }));
  });

  it("draws the task block through the caller's render prop", async () => {
    const { wrap } = setup();
    const layout: Layout = { type: "stack", children: [block("home", "m", "label"), task] };
    await renderIn("en", wrap(<LayoutView layout={layout} shown="work" task={() => <p>the task</p>} />), { theme: true });
    expect(screen.getByText("the task")).toBeTruthy();
  });

  it("leaves a hidden node out", async () => {
    const { registry, wrap } = setup();
    registry.register("m", "label", Label);
    const layout: Layout = {
      type: "stack",
      children: [{ type: "row", id: "home", children: [block("a", "m", "label", { text: "Shown" }), { ...block("b", "m", "label", { text: "Hidden" }), hidden: true }] }, task],
    };
    await renderIn("en", wrap(<LayoutView layout={layout} shown="home" task={() => null} />), { theme: true });
    expect(screen.getByText("Shown")).toBeTruthy();
    expect(screen.queryByText("Hidden")).toBeNull();
    expect(document.querySelector('[data-layout-id="b"]')).toBeNull();
  });

  it("a stack shows only the child it is told to, under its header", async () => {
    const { registry, wrap } = setup();
    registry.register("m", "label", Label);
    const layout: Layout = {
      type: "stack",
      header: { mod: "m", block: "label", props: { text: "Header" } },
      children: [block("home", "m", "label", { text: "Home" }), { type: "column", id: "work", children: [task] }],
    };
    const { rerender } = await renderIn("en", wrap(<LayoutView layout={layout} shown="home" task={() => <p>Task</p>} />), { theme: true });
    expect(screen.getByText("Header")).toBeTruthy();
    expect(screen.getByText("Home")).toBeTruthy();
    expect(screen.queryByText("Task")).toBeNull();
    rerender(wrap(<LayoutView layout={layout} shown="work" task={() => <p>Task</p>} />));
    expect(screen.getByText("Task")).toBeTruthy();
    expect(screen.queryByText("Home")).toBeNull();
    // An inner stack without `shown` for it shows its first visible child.
    cleanup();
    const inner: Layout = { type: "stack", children: [{ type: "stack", id: "home", children: [{ ...block("x", "m", "label", { text: "X" }), hidden: true }, block("y", "m", "label", { text: "Y" })] }, task] };
    await renderIn("en", wrap(<LayoutView layout={inner} shown="home" task={() => null} />), { theme: true });
    expect(screen.getByText("Y")).toBeTruthy();
    expect(screen.queryByText("X")).toBeNull();
  });

  it("an off mod's block says so, and Turn on turns it on", async () => {
    const { registry, wrap, set } = setup(view(false));
    registry.register("notes", "list", () => <p>notes list</p>);
    const layout: Layout = { type: "stack", children: [block("home", "notes", "list"), task] };
    await renderIn("en", wrap(<LayoutView layout={layout} shown="home" task={() => null} />), { theme: true });
    expect(await screen.findByText("Mod Notes is off")).toBeTruthy();
    expect(screen.queryByText("notes list")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Turn on" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith("notes", true));
    // Main's answer has it on: the block shows.
    expect(await screen.findByText("notes list")).toBeTruthy();
  });

  it("a block that throws shows the failure card, and Turn off turns its mod off", async () => {
    const { registry, wrap, set } = setup(view(true));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    registry.register("notes", "list", () => {
      throw new Error("boom");
    });
    const layout: Layout = { type: "stack", children: [block("home", "notes", "list"), task] };
    await renderIn("en", wrap(<LayoutView layout={layout} shown="home" task={() => null} />), { theme: true });
    expect(await screen.findByText("This part of the app failed")).toBeTruthy();
    expect(await screen.findByText("Notes")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Turn off" }));
    await waitFor(() => expect(set).toHaveBeenCalledWith("notes", false));
    expect(await screen.findByText("Mod Notes is off")).toBeTruthy();
    quiet.mockRestore();
  });

  it("a block no mod registered isn't available yet", async () => {
    const { wrap } = setup();
    const layout: Layout = { type: "stack", children: [block("home", "ghost", "panel"), task] };
    await renderIn("en", wrap(<LayoutView layout={layout} shown="home" task={() => null} />), { theme: true });
    expect(screen.getByText("This part isn't available yet")).toBeTruthy();
  });

  it("a block registered after the first draw shows, and its disposer takes it away", async () => {
    const { registry, wrap } = setup();
    const layout: Layout = { type: "stack", children: [block("home", "m", "late"), task] };
    await renderIn("en", wrap(<LayoutView layout={layout} shown="home" task={() => null} />), { theme: true });
    expect(screen.getByText("This part isn't available yet")).toBeTruthy();
    let dispose = () => {};
    await waitFor(() => {
      dispose = registry.register("m", "late", () => <p>late</p>);
    });
    expect(await screen.findByText("late")).toBeTruthy();
    await waitFor(() => dispose());
    expect(await screen.findByText("This part isn't available yet")).toBeTruthy();
  });
});

describe("the default registry", () => {
  it("registerBlock returns a disposer and blockFor finds the component", () => {
    const C = () => null;
    const dispose = registerBlock("test-mod", "thing", C);
    expect(blockFor("test-mod", "thing")).toBe(C);
    dispose();
    expect(blockFor("test-mod", "thing")).toBeUndefined();
  });
});
