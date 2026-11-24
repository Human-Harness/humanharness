// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InputSpec, ModsView } from "../src/client";
import { ChatView } from "../src/ChatView";
import { InputForm } from "../src/InputForm";
import { type UiCtx, startModLoader } from "../src/layout/mod-loader";
import { type BlockRegistry, type ComposerReviewer, type OverlayButtonProps, type OverlayPanelProps, type ReviewVerdict, type TaskBarProps, ModBlocksProvider, createBlockRegistry } from "../src/layout/registry";
import { answerReview } from "../src/task-view/review";
import { FakeClient } from "./fake-client";
import { renderIn } from "./render";

const realMatchMedia = window.matchMedia;
afterEach(() => {
  cleanup();
  window.matchMedia = realMatchMedia;
  vi.restoreAllMocks();
});

/** Runs a test mod's `ui(ctx)` through the window's loader, into `registry`. */
async function load(registry: BlockRegistry, ui: (ctx: UiCtx) => void) {
  const mods = {
    view: async (): Promise<ModsView> => ({ mods: [], problems: [] }),
    onChanged: () => () => {},
    onReloaded: () => () => {},
    call: async () => undefined,
    on: () => () => {},
  };
  const loader = startModLoader({ client: { mods }, registry, core: [{ id: "test", ui }] });
  await loader.settled();
  return loader;
}

/** ChatView with the top bar's slot, the mods' parts from `registry`. */
async function chat(registry: BlockRegistry) {
  const client = new FakeClient({ language: "en", folder: "/w", engineId: "claude" });
  const set = vi.fn(async (_id: string, _on: boolean): Promise<ModsView> => ({ mods: [], problems: [] }));
  client.mods = { ...client.mods, set };
  const el = document.createElement("div");
  document.body.appendChild(el);
  const bar = { el, harness: "Demo", open: false, onHome: () => {}, switcher: <span>Task</span> };
  await renderIn(
    "en",
    <ModBlocksProvider registry={registry}>
      <ChatView client={client} state={client.state} components={{}} stateBlocks={[]} bar={bar} />
    </ModBlocksProvider>,
  );
  const box = await screen.findByRole("textbox");
  return { client, set, el, box };
}

const Boom = (): ReactNode => {
  throw new Error("boom");
};
const Bar = ({ task }: TaskBarProps) => <span>Mod piece · {task ?? "no task"}</span>;
const Button = ({ expanded, controls, onOpen, buttonRef }: OverlayButtonProps) => (
  <button type="button" ref={buttonRef} aria-expanded={expanded} aria-controls={controls} onClick={onOpen}>
    Helper
  </button>
);
const Panel = ({ close }: OverlayPanelProps) => (
  <div>
    <p>Helper panel</p>
    <button type="button" onClick={close}>
      Done here
    </button>
  </div>
);

describe("a mod's task bar piece (ctx.taskBar)", () => {
  it("renders in the bar's slot; one that throws shows the failed part with Turn off", async () => {
    const registry = createBlockRegistry();
    await load(registry, (ctx) => {
      ctx.taskBar(Bar);
      ctx.taskBar(Boom);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { el, set } = await chat(registry);
    expect(within(el).getByText("Mod piece · no task")).toBeTruthy();
    fireEvent.click(within(within(el).getByRole("alert")).getByRole("button", { name: "Turn off" }));
    expect(set).toHaveBeenCalledWith("test", false);
  });
});

describe("a mod's right overlay (ctx.taskOverlay)", () => {
  it("its button in the bar opens and folds it, one overlay at a time, behind the boundary", async () => {
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.taskOverlay({ name: "Helper", button: Button, panel: Panel }));
    const { el } = await chat(registry);
    const button = within(el).getByRole("button", { name: "Helper" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    const panel = await screen.findByRole("complementary", { name: "Helper" });
    expect(panel.id).toBe(button.getAttribute("aria-controls"));
    expect(within(panel).getByText("Helper panel")).toBeTruthy();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(within(panel).getByRole("button", { name: "Done here" }));
    await waitFor(() => expect(screen.queryByRole("complementary", { name: "Helper" })).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("a panel that throws shows the failed part", async () => {
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.taskOverlay({ name: "Helper", button: Button, panel: Boom }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { el } = await chat(registry);
    fireEvent.click(within(el).getByRole("button", { name: "Helper" }));
    const panel = await screen.findByRole("complementary", { name: "Helper" });
    expect(within(panel).getByRole("alert")).toBeTruthy();
  });

  it("not in a narrow window, like Sidekick's", async () => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.taskOverlay({ name: "Helper", button: Button, panel: Panel }));
    const { el } = await chat(registry);
    expect(within(el).queryByRole("button", { name: "Helper" })).toBeNull();
  });
});

describe("a mod's reviewer (ctx.composer)", () => {
  function reviewer(verdict: () => Promise<ReviewVerdict>, over: Omit<ComposerReviewer, "review"> = {}) {
    const review = vi.fn((_text: string, _signal: AbortSignal, _o: { force: boolean; answer: boolean }) => verdict());
    return { wait: 30, ...over, review };
  }

  it("Enter reviews first with the countdown; a send verdict sends", async () => {
    let answer: (v: ReviewVerdict) => void = () => {};
    const r = reviewer(() => new Promise((res) => (answer = res)));
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.composer(r));
    const { client, box } = await chat(registry);
    fireEvent.change(box, { target: { value: "Fix it" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(r.review).toHaveBeenCalledWith("Fix it", expect.any(AbortSignal), { force: false, answer: false }));
    expect(await screen.findByText(/Sends anyway in \d+ s/)).toBeTruthy();
    expect(client.sent).toEqual([]);
    await act(async () => answer("send"));
    await waitFor(() => expect(client.sent).toEqual(["Fix it"]));
  });

  it("a hold keeps the draft and sends nothing", async () => {
    const r = reviewer(async () => "hold");
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.composer(r));
    const { client, box } = await chat(registry);
    fireEvent.change(box, { target: { value: "Fix it" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(r.review).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText(/Sends anyway/)).toBeNull());
    expect(client.sent).toEqual([]);
    expect((box as HTMLTextAreaElement).value).toBe("Fix it");
  });

  it("⌘⏎ sends at once and aborts the review; ⌥⏎ forces one", async () => {
    const r = reviewer(() => new Promise(() => undefined));
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.composer(r));
    const { client, box } = await chat(registry);
    fireEvent.change(box, { target: { value: "Fix it" } });
    fireEvent.keyDown(box, { key: "Enter", altKey: true });
    await waitFor(() => expect(r.review).toHaveBeenCalledWith("Fix it", expect.any(AbortSignal), { force: true, answer: false }));
    const signal = r.review.mock.calls[0]![1];
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    await waitFor(() => expect(client.sent).toEqual(["Fix it"]));
    expect(signal.aborted).toBe(true);
  });

  it("past its wait the text goes as typed", async () => {
    const r = reviewer(() => new Promise(() => undefined), { wait: 0.05 });
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.composer(r));
    const { client, box } = await chat(registry);
    fireEvent.change(box, { target: { value: "Fix it" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(client.sent).toEqual(["Fix it"]));
  });

  it("its marks underline the draft", async () => {
    const r = reviewer(async () => "send", { marks: (d: string) => (d ? [[0, 3]] : []) });
    const registry = createBlockRegistry();
    await load(registry, (ctx) => ctx.composer(r));
    const { box } = await chat(registry);
    fireEvent.change(box, { target: { value: "Fix it" } });
    expect(box.closest(".hh-sk-flagged")).not.toBeNull();
    expect(document.querySelector(".hh-sk-backdrop mark")?.textContent).toBe("Fix");
  });

  it("the answer form uses the same reviewer: a hold keeps the form, a send submits", async () => {
    const spec: InputSpec = { fields: [{ name: "why", kind: "longText", label: "Why?", optional: false }] };
    for (const [verdict, submitted] of [
      ["hold", false],
      ["send", true],
    ] as const) {
      const r = reviewer(async () => verdict);
      const submit = vi.fn();
      const run = { current: null };
      await renderIn("en", <InputForm spec={spec} data={null} disabled={false} sending={false} errors={[]} submit={submit} {...answerReview(r, () => false, run)} />);
      fireEvent.change(screen.getByLabelText("Why?"), { target: { value: "Because" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(r.review).toHaveBeenCalledWith("Because", expect.any(AbortSignal), { force: false, answer: true }));
      if (submitted) await waitFor(() => expect(submit).toHaveBeenCalled());
      else expect(submit).not.toHaveBeenCalled();
      cleanup();
    }
  });
});
