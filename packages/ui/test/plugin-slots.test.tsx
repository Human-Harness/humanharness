// @vitest-environment happy-dom
// happy-dom can't fetch hh-plugin:, so it doesn't navigate child frames here; each frame still fires one `load`.
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type HarnessAppProps, HarnessApp, PluginSlot } from "../src";
import type { PluginChipView, PluginPanelView, PluginSurfaceView } from "../src/client";
import { reloadOf } from "../src/plugins/surface";
import { FakeClient } from "./fake-client";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

const panel = (over: Partial<PluginPanelView> = {}): PluginPanelView => ({
  plugin: "oncall",
  pluginName: "On-call",
  id: "queue",
  title: "Queue",
  slot: "plugins",
  url: "hh-plugin://oncall/panel-queue.html",
  ...over,
});
const chip = (over: Partial<PluginChipView> = {}): PluginChipView => ({
  plugin: "oncall",
  pluginName: "On-call",
  id: "count",
  slot: "chips",
  text: "3 open",
  severity: "warn",
  ...over,
});
const surface = (over: Partial<PluginSurfaceView> = {}): PluginSurfaceView => ({ panels: [], chips: [], reloads: {}, ...over });
const QUEUE = panel();
const DIGEST = panel({ plugin: "news", pluginName: "News", id: "digest", title: "Digest", url: "hh-plugin://news/panel-digest.html" });
const BOTTOM = panel({ id: "graph", title: "Graph", slot: "bottom", url: "hh-plugin://oncall/panel-graph.html" });

function makeClient(opts: { plugins?: boolean; flow?: boolean; view?: PluginSurfaceView } = {}) {
  const c = new FakeClient(ready);
  if (opts.plugins !== false) c.state.plugins = { local: true };
  if (opts.flow !== false) {
    c.state.actions = { manifest: { label: "The manifest", cost: "medium" } };
    c.state.path = ["manifest"];
  }
  if (opts.view) c.surfaceView = opts.view;
  return c;
}
async function open(c: FakeClient, props: Partial<HarnessAppProps> = {}) {
  render(<HarnessApp client={c} {...props} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByRole("textbox");
  await screen.findByRole("button", { name: "History" });
}
const frames = () => [...document.querySelectorAll("iframe")];
const section = () => screen.queryByRole("region", { name: "Plugins" });

describe("plugin slots", () => {
  it("D0: without state.plugins nothing is asked and nothing new is drawn", async () => {
    const c = makeClient({ plugins: false, view: surface({ panels: [QUEUE], chips: [chip({ panel: "queue" })] }) });
    const get = vi.spyOn(c.plugins, "surface");
    const sub = vi.spyOn(c.plugins, "onSurface");
    await open(c, { renderSide: () => <PluginSlot id="bottom" /> });
    expect(get).not.toHaveBeenCalled();
    expect(sub).not.toHaveBeenCalled();
    expect(document.querySelector(".hh-pl-chip")).toBeNull();
    expect(section()).toBeNull();
    expect(frames()).toHaveLength(0);
  });

  it("D0: with state.plugins and an empty surface nothing new is drawn", async () => {
    const c = makeClient();
    const get = vi.spyOn(c.plugins, "surface");
    await open(c);
    await waitFor(() => expect(get).toHaveBeenCalled());
    expect(document.querySelector(".hh-pl-chip, .hh-pl-chips")).toBeNull();
    expect(section()).toBeNull();
    expect(frames()).toHaveLength(0);
  });

  it("D0: without flow and without material or panels there is no side nav", async () => {
    const c = makeClient({ flow: false });
    await open(c);
    expect(document.querySelector(".hh-flow-side")).toBeNull();
  });

  it("shows the Plugins section's panels as tabs and switches frames; a panel in another slot stays out", async () => {
    const c = makeClient({ view: surface({ panels: [QUEUE, DIGEST, BOTTOM] }) });
    await open(c);
    const sec = await screen.findByRole("region", { name: "Plugins" });
    expect(sec.closest("nav.hh-flow-side")).not.toBeNull();
    const tabs = within(within(sec).getByRole("tablist", { name: "Plugin panels" })).getAllByRole("tab");
    expect(tabs.map((t) => t.textContent)).toEqual(["Queue", "Digest"]);
    expect(tabs.map((t) => t.getAttribute("title"))).toEqual(["On-call", "News"]);
    expect(tabs[0].getAttribute("aria-selected")).toBe("true");
    expect(frames().map((f) => f.getAttribute("src"))).toEqual([QUEUE.url]);
    expect(within(sec).getByText("On-call")).toBeTruthy();
    fireEvent.click(tabs[1]);
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
    expect(frames().map((f) => f.getAttribute("src"))).toEqual([DIGEST.url]);
    // Arrow keys move between tabs.
    fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
    expect(frames().map((f) => f.getAttribute("src"))).toEqual([QUEUE.url]);
  });

  it("follows main's pushes: a panel that appears adds the section, one that goes removes it", async () => {
    const c = makeClient();
    const sub = vi.spyOn(c.plugins, "onSurface");
    await open(c);
    await waitFor(() => expect(sub).toHaveBeenCalled());
    act(() => c.emitSurface(surface({ panels: [QUEUE] })));
    expect(await screen.findByRole("region", { name: "Plugins" })).toBeTruthy();
    act(() => c.emitSurface(surface()));
    expect(section()).toBeNull();
    expect(frames()).toHaveLength(0);
  });

  it("without flow, the section gets a side nav of its own", async () => {
    const c = makeClient({ flow: false, view: surface({ panels: [QUEUE] }) });
    await open(c);
    const sec = await screen.findByRole("region", { name: "Plugins" });
    const nav = sec.closest("nav.hh-flow-side");
    expect(nav?.getAttribute("aria-label")).toBe("Plugins");
  });

  it("a harness side panel's <PluginSlot> shows the panels of its slot, headed with the plugin", async () => {
    const c = makeClient({ view: surface({ panels: [QUEUE, BOTTOM] }) });
    await open(c, { renderSide: () => <PluginSlot id="bottom" /> });
    const slot = await screen.findByRole("region", { name: "Graph · On-call" });
    expect(slot.closest("aside.hh-side")).not.toBeNull();
    expect(within(slot).getByText("Graph · On-call")).toBeTruthy();
    expect(slot.querySelector("iframe")?.getAttribute("src")).toBe(BOTTOM.url);
    expect(within(slot).getByTitle("Graph · On-call").tagName).toBe("IFRAME");
  });

  it("<PluginSlot> outside the chat, or for a slot with nothing, draws nothing", async () => {
    const { container } = render(<PluginSlot id="bottom" />);
    expect(container.innerHTML).toBe("");
    cleanup();
    const c = makeClient({ view: surface({ panels: [QUEUE] }) });
    await open(c, { renderSide: () => <div data-testid="side"><PluginSlot id="bottom" /></div> });
    await screen.findByRole("region", { name: "Plugins" });
    expect(screen.getByTestId("side").innerHTML).toBe("");
  });

  it("<PluginSlot> of a chip slot shows its chips", async () => {
    const c = makeClient({ view: surface({ chips: [chip({ slot: "status", text: "Paged" }), chip({ id: "other" })] }) });
    await open(c, { renderSide: () => <PluginSlot id="status" /> });
    const side = document.querySelector("aside.hh-side") as HTMLElement;
    await waitFor(() => expect(within(side).getByText("Paged")).toBeTruthy());
    expect(within(side).queryByText("3 open")).toBeNull();
  });

  it("draws chips after the usage meter: a button opens its panel's tab, one without a panel is text", async () => {
    const c = makeClient({
      view: surface({
        panels: [DIGEST, QUEUE],
        chips: [chip({ panel: "queue" }), chip({ plugin: "news", pluginName: "News", id: "n", text: "Quiet", severity: "info" })],
      }),
    });
    await open(c);
    const button = await screen.findByRole("button", { name: /^3 open/ });
    expect(button.className).toBe("hh-pl-chip warn");
    expect(button.getAttribute("title")).toBe("On-call: 3 open");
    expect(button.textContent).toContain("Open On-call");
    const quiet = screen.getByText("Quiet");
    expect(quiet.tagName).toBe("SPAN");
    expect(quiet.className).toBe("hh-pl-chip info");
    // Right after the usage meter in the top bar.
    const chips = button.closest(".hh-pl-chips") as HTMLElement;
    expect(chips.previousElementSibling?.className).toMatch(/hh-usage/);
    expect(frames().map((f) => f.getAttribute("src"))).toEqual([DIGEST.url]);
    fireEvent.click(button);
    await waitFor(() => expect(frames().map((f) => f.getAttribute("src"))).toEqual([QUEUE.url]));
    const tabs = screen.getAllByRole("tab");
    expect(tabs[1].getAttribute("aria-selected")).toBe("true");
  });

  it("P9: chip text and panel titles are plain text, never markup", async () => {
    const evil = '<img src=x onerror="window.pwned=1"><b>bold</b>';
    const c = makeClient({
      view: surface({ panels: [panel({ title: evil, pluginName: evil })], chips: [chip({ text: evil, panel: "queue" })] }),
    });
    await open(c);
    await screen.findByRole("region", { name: "Plugins" });
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".hh-pl-chips b, .hh-pl-section b")).toBeNull();
    expect(screen.getByRole("tab").textContent).toBe(evil);
    expect(document.querySelector(".hh-pl-chip")?.firstChild?.textContent).toBe(evil);
    for (const el of document.querySelectorAll(".hh-pl-chip, .hh-pl-tab, .hh-pl-panel-head")) expect(el.getAttribute("dir")).toBe("auto");
  });

  it("a dev reload remounts that plugin's frames only", async () => {
    const c = makeClient({ view: surface({ panels: [QUEUE, BOTTOM] }) });
    const sub = vi.spyOn(c.plugins, "onSurface");
    await open(c, { renderSide: () => <PluginSlot id="bottom" /> });
    await screen.findByRole("region", { name: "Plugins" });
    await waitFor(() => expect(sub).toHaveBeenCalled());
    const [a, b] = frames();
    act(() => c.emitSurface(surface({ panels: [QUEUE, BOTTOM], reloads: { news: 3 } })));
    expect(frames()[0]).toBe(a);
    expect(frames()[1]).toBe(b);
    act(() => c.emitSurface(surface({ panels: [QUEUE, BOTTOM], reloads: { oncall: 1 } })));
    expect(frames()).toHaveLength(2);
    expect(frames()[0]).not.toBe(a);
    expect(frames()[1]).not.toBe(b);
  });

  it("a reload count is read from main's own keys only", () => {
    expect(reloadOf(surface({ reloads: { oncall: 2 } }), "oncall")).toBe(2);
    expect(reloadOf(surface(), "constructor")).toBe(0);
    expect(reloadOf(surface(), "__proto__")).toBe(0);
    expect(reloadOf(surface({ reloads: { oncall: Number.NaN } }), "oncall")).toBe(0);
  });
});
