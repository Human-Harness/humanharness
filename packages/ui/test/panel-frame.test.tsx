// @vitest-environment happy-dom
// happy-dom can't fetch hh-plugin:, so it doesn't navigate child frames here; each frame still fires one `load`.
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { createI18n } from "@humanharness/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PanelAnswer, PluginPanelView } from "../src/client";
import { PANEL_SANDBOX, PanelFrame } from "../src/plugins/PanelFrame";
import { FakeClient } from "./fake-client";
import "./render";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };
const view = (over: Partial<PluginPanelView> = {}): PluginPanelView => ({
  plugin: "oncall",
  pluginName: "On-call",
  id: "queue",
  title: "Queue",
  slot: "plugins",
  url: "hh-plugin://oncall/panel-queue.html",
  ...over,
});

type Spy = { mock: { calls: unknown[][] } };
interface Mounted {
  client: FakeClient;
  frame: HTMLIFrameElement;
  win: Window;
  posts: Spy;
  rerender: (ui: { focus?: string; reload?: number; panel?: PluginPanelView }) => void;
}

/** Watches what goes into the frame's window; set right after the element is committed, before its `load`. */
function watch(frame: HTMLIFrameElement): { win: Window; posts: Spy } {
  const win = frame.contentWindow as Window;
  return { win, posts: vi.spyOn(win, "postMessage") as unknown as Spy };
}
const sent = (posts: Spy) => posts.mock.calls.map((c) => c[0] as Record<string, unknown>);
const loaded = (posts: Spy) => waitFor(() => expect(sent(posts).some((m) => m.event === "theme")).toBe(true));
const frameEl = () => document.querySelector("iframe") as HTMLIFrameElement;

async function mount(opts: { focus?: string; client?: FakeClient } = {}): Promise<Mounted> {
  const client = opts.client ?? new FakeClient(ready);
  client.state.plugins = { local: true };
  let props = { focus: opts.focus, reload: 0, panel: view() };
  const i18n = await createI18n("en");
  const ui = () => (
    <I18nextProvider i18n={i18n}>
      <PanelFrame client={client} {...props} />
    </I18nextProvider>
  );
  // Rendered and watched in one synchronous step: the frame's first `load` comes right after.
  const utils = render(ui());
  const w = watch(frameEl());
  await loaded(w.posts);
  return {
    client,
    frame: frameEl(),
    win: w.win,
    posts: w.posts,
    rerender: (next) => {
      props = { ...props, ...next };
      utils.rerender(ui());
    },
  };
}

function message(data: unknown, source: unknown, origin = "null") {
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: source as Window, origin }));
  });
}
const call = (id: number, name: string, args: unknown = {}) => ({ hh: 1, id, call: name, args });
const flush = () => act(async () => {});
const panelCalls = (c: FakeClient) => c.pluginCalls.filter((x) => x[0] === "panel");

describe("PanelFrame", () => {
  it("renders the panel's page in a frame whose sandbox is only allow-scripts", async () => {
    const { frame } = await mount();
    expect(PANEL_SANDBOX).toBe("allow-scripts");
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("src")).toBe("hh-plugin://oncall/panel-queue.html");
    expect(frame.getAttribute("title")).toBe("Queue · On-call");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(frame.getAttribute("allow")).toBe("");
  });

  it("calls main with the plugin and panel of its props and posts the answer back", async () => {
    const { client, win, posts } = await mount();
    client.panelAnswers = () => ({ ok: true, value: [{ id: 1 }] });
    message({ ...call(7, "data.query", { collection: "queues" }), plugin: "other", panel: "x" }, win);
    await flush();
    expect(panelCalls(client)).toEqual([["panel", "oncall", "queue", "data.query", { collection: "queues" }]]);
    expect(posts).toHaveBeenCalledWith({ hh: 1, re: 7, ok: true, value: [{ id: 1 }] }, "*");
  });

  it("P4: ignores a message from another window, from no window, with another origin, not hh 1, or over 64 KB", async () => {
    const { client, win } = await mount();
    message(call(1, "data.query"), window);
    message(call(2, "data.query"), null);
    message(call(3, "data.query"), {});
    message(call(4, "data.query"), win, "hh-plugin://oncall");
    message({ ...call(5, "data.query"), hh: 2 }, win);
    message({ id: 6, call: "data.query", args: {} }, win);
    message(call(7, "data.query", { q: "x".repeat(64 * 1024) }), win);
    await flush();
    expect(panelCalls(client)).toEqual([]);
  });

  it("sends main plain JSON only: a binary or Map arg arrives as {} and never whole", async () => {
    const { client, win } = await mount();
    message(call(8, "data.query", { collection: "queues", x: new ArrayBuffer(1024 * 1024), m: new Map([["a", 1]]) }), win);
    await flush();
    expect(panelCalls(client)).toEqual([["panel", "oncall", "queue", "data.query", { collection: "queues", x: {}, m: {} }]]);
  });

  it("answers an unknown call without asking main, and a refused or failing call as an error", async () => {
    const { client, win, posts } = await mount();
    message(call(1, "secrets.get"), win);
    client.panelAnswers = () => ({ ok: false, error: "Not running" });
    message(call(2, "settings.get"), win);
    await flush();
    client.panelAnswers = () => Promise.reject(new Error("boom"));
    message(call(3, "refresh"), win);
    await flush();
    expect(panelCalls(client).map((c) => c[3])).toEqual(["settings.get", "refresh"]);
    expect(posts).toHaveBeenCalledWith({ hh: 1, re: 1, ok: false, error: "Unknown call" }, "*");
    expect(posts).toHaveBeenCalledWith({ hh: 1, re: 2, ok: false, error: "Not running" }, "*");
    expect(posts).toHaveBeenCalledWith({ hh: 1, re: 3, ok: false, error: "The call failed" }, "*");
  });

  it("lets 20 calls a second through; the rest are answered Too many calls", async () => {
    const { client, win, posts } = await mount();
    client.panelAnswers = () => ({ ok: true, value: null });
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    for (let i = 1; i <= 25; i++) {
      message(call(i, "settings.get"), win);
      await flush();
    }
    expect(panelCalls(client)).toHaveLength(20);
    const refused = sent(posts).filter((m) => m.error === "Too many calls");
    expect(refused.map((m) => m.re)).toEqual([21, 22, 23, 24, 25]);
  });

  it("keeps at most 8 calls in flight", async () => {
    const { client, win, posts } = await mount();
    const waiting: ((a: PanelAnswer) => void)[] = [];
    client.panelAnswers = () => new Promise<PanelAnswer>((r) => waiting.push(r));
    for (let i = 1; i <= 10; i++) message(call(i, "data.query"), win);
    await flush();
    expect(panelCalls(client)).toHaveLength(8);
    expect(sent(posts).filter((m) => m.error === "Too many calls at once").map((m) => m.re)).toEqual([9, 10]);
    waiting[0]({ ok: true, value: 1 });
    await flush();
    message(call(11, "data.query"), win);
    await flush();
    expect(panelCalls(client)).toHaveLength(9);
  });

  it("resize sets the height within 120–800 and never reaches main or the call limits", async () => {
    const { client, frame, win } = await mount();
    message(call(1, "resize", { height: 5000 }), win);
    expect(frame.style.height).toBe("800px");
    message(call(2, "resize", { height: 10 }), win);
    expect(frame.style.height).toBe("120px");
    message(call(3, "resize", { height: "300" }), win);
    expect(frame.style.height).toBe("120px");
    vi.spyOn(Date, "now").mockReturnValue(Date.now());
    for (let i = 0; i < 40; i++) message(call(10 + i, "resize", { height: 300 + i }), win);
    expect(frame.style.height).toBe("339px");
    client.panelAnswers = () => ({ ok: true, value: null });
    message(call(99, "settings.get"), win);
    await flush();
    expect(panelCalls(client)).toEqual([["panel", "oncall", "queue", "settings.get", {}]]);
  });

  it("posts a data event only for its own plugin", async () => {
    const { client, posts } = await mount();
    act(() => client.emitPluginData({ plugin: "other", collections: ["queues"] }));
    expect(sent(posts).some((m) => m.event === "data")).toBe(false);
    act(() => client.emitPluginData({ plugin: "oncall", collections: ["queues", "pages"] }));
    expect(posts).toHaveBeenCalledWith({ hh: 1, event: "data", collections: ["queues", "pages"] }, "*");
  });

  it("posts the theme on load and when it changes, and the focus after load and when it changes", async () => {
    let dark = true;
    const listeners = new Set<() => void>();
    vi.spyOn(window, "matchMedia").mockImplementation(
      (q: string) =>
        ({
          media: q,
          get matches() {
            return dark;
          },
          addEventListener: (_: string, l: () => void) => listeners.add(l),
          removeEventListener: (_: string, l: () => void) => listeners.delete(l),
        }) as unknown as MediaQueryList,
    );
    const { posts, rerender } = await mount({ focus: "INC-42" });
    expect(posts).toHaveBeenCalledWith({ hh: 1, event: "theme", dark: true }, "*");
    expect(posts).toHaveBeenCalledWith({ hh: 1, event: "focus", focus: "INC-42" }, "*");
    dark = false;
    act(() => {
      for (const l of listeners) l();
    });
    expect(posts).toHaveBeenCalledWith({ hh: 1, event: "theme", dark: false }, "*");
    rerender({ focus: "INC-43" });
    expect(posts).toHaveBeenCalledWith({ hh: 1, event: "focus", focus: "INC-43" }, "*");
    cleanup();
    expect(listeners.size).toBe(0);
  });

  it("P3: a second load remounts the frame; the old frame's messages and answers are dropped", async () => {
    const { client, frame, win, posts } = await mount();
    let answer: (a: PanelAnswer) => void = () => {};
    client.panelAnswers = () => new Promise<PanelAnswer>((r) => (answer = r));
    message(call(1, "data.query"), win);
    act(() => {
      fireEvent.load(frame);
      // Between the second load and the new frame, the old one no longer speaks.
      window.dispatchEvent(new MessageEvent("message", { data: call(2, "settings.get"), source: win, origin: "null" }));
    });
    const fresh = frameEl();
    const next = watch(fresh);
    expect(fresh).not.toBe(frame);
    expect(fresh.getAttribute("src")).toBe("hh-plugin://oncall/panel-queue.html");
    expect(fresh.getAttribute("sandbox")).toBe("allow-scripts");
    await act(async () => answer({ ok: true, value: "late" }));
    expect(sent(posts).some((m) => m.re === 1 || m.re === 2)).toBe(false);
    message(call(3, "settings.get"), win);
    await flush();
    expect(panelCalls(client).map((c) => c[3])).toEqual(["data.query"]);
    await loaded(next.posts);
    client.panelAnswers = () => ({ ok: true, value: "new" });
    message(call(4, "settings.get"), next.win);
    await flush();
    expect(next.posts).toHaveBeenCalledWith({ hh: 1, re: 4, ok: true, value: "new" }, "*");
  });

  it("P3: past 3 remounts a minute it stops with an error and no frame", async () => {
    await mount();
    for (let i = 0; i < 3; i++) {
      const frame = frameEl();
      act(() => {
        fireEvent.load(frame);
      });
      const next = watch(frameEl());
      expect(frameEl()).not.toBe(frame);
      await loaded(next.posts);
    }
    act(() => {
      fireEvent.load(frameEl());
    });
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.getByRole("alert").textContent).toBe("This panel kept reloading itself, so it was stopped.");
  });

  it("a dev reload gives a fresh frame and a fresh count", async () => {
    const { frame, rerender } = await mount();
    rerender({ reload: 1 });
    expect(frameEl()).not.toBe(frame);
  });

  it("a dev reload resets the remount count: a stopped panel comes back, with 3 remounts again", async () => {
    const { rerender } = await mount();
    const selfRemount = async () => {
      const frame = frameEl();
      act(() => {
        fireEvent.load(frame);
      });
      const next = watch(frameEl());
      expect(frameEl()).not.toBe(frame);
      await loaded(next.posts);
    };
    for (let i = 0; i < 3; i++) await selfRemount();
    act(() => {
      fireEvent.load(frameEl());
    });
    expect(document.querySelector("iframe")).toBeNull();
    rerender({ reload: 1 });
    expect(document.querySelector("iframe")).not.toBeNull();
    await loaded(watch(frameEl()).posts);
    for (let i = 0; i < 3; i++) await selfRemount();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("unsubscribes from plugin data on unmount, and a remount keeps one subscription", async () => {
    const { client, frame, rerender } = await mount();
    expect(client.pluginDataListenerCount).toBe(1);
    act(() => {
      fireEvent.load(frame);
    });
    rerender({ reload: 1 });
    expect(client.pluginDataListenerCount).toBe(1);
    cleanup();
    expect(client.pluginDataListenerCount).toBe(0);
  });

  it("drops an answer that arrives after unmount", async () => {
    const { client, win, posts } = await mount();
    let answer: (a: PanelAnswer) => void = () => {};
    client.panelAnswers = () => new Promise<PanelAnswer>((r) => (answer = r));
    message(call(1, "data.query"), win);
    cleanup();
    await act(async () => answer({ ok: true, value: 1 }));
    expect(sent(posts).some((m) => m.re === 1)).toBe(false);
    message(call(2, "data.query"), win);
    expect(panelCalls(client)).toHaveLength(1);
  });
});
