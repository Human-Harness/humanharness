// @vitest-environment happy-dom
// happy-dom can't fetch hh-plugin:, so it doesn't navigate child frames here; each frame still fires one `load`.
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { PluginPanelView, PluginSurfaceView, SearchAnswer, SearchHitView } from "../src/client";
import { FakeClient } from "./fake-client";

afterEach(cleanup);

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
const QUEUE = panel();
const DIGEST = panel({ plugin: "news", pluginName: "News", id: "digest", title: "Digest", url: "hh-plugin://news/panel-digest.html" });
const surface = (panels: PluginPanelView[]): PluginSurfaceView => ({ panels, chips: [], reloads: {} });
const INCIDENT: SearchHitView = { id: "data:plugin:oncall/incidents#INC-42", kind: "data", title: [{ text: "INC-42" }], context: [], plugin: "On-call", hint: null, target: { kind: "panel", plugin: "oncall", panel: "queue", focus: "INC-42" } };
const answer = (query: string, hits: SearchHitView[]): SearchAnswer => ({
  ok: true,
  query,
  groups: [{ kind: "data", total: hits.length, hits }],
  counts: { task: 0, note: 0, file: 0, data: hits.length },
  recent: [],
  partial: false,
  status: { state: "ready", done: 1, total: 1 },
  allScopes: false,
});

/** Picks the incident row on Home while the work screen's first surface read is held back; returns its release. */
async function pickFromHome(view: PluginSurfaceView) {
  const c = new FakeClient(ready);
  c.state.plugins = { local: true };
  c.searchAnswers.inc = answer("inc", [INCIDENT]);
  let release: () => void = () => undefined;
  const held = new Promise<PluginSurfaceView>((resolve) => {
    release = () => resolve(view);
  });
  vi.spyOn(c.plugins, "surface").mockReturnValue(held);
  render(<HarnessApp client={c} />);
  await screen.findByRole("button", { name: "Start Demo" });
  act(() => c.search.open("inc"));
  const dialog = await screen.findByRole("dialog", { name: "Search" });
  fireEvent.click(await within(dialog).findByRole("option"));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
  await act(async () => {});
  return release;
}

describe("a plugin record picked away from the work screen (search spec §3 Data)", () => {
  it("opens its panel once the plugin surface has loaded", async () => {
    const release = await pickFromHome(surface([DIGEST, QUEUE]));
    await act(async () => release());
    await waitFor(() => expect(screen.getByRole("tab", { name: "Queue" }).getAttribute("aria-selected")).toBe("true"));
  });

  it("opens nothing when the loaded surface doesn't have its panel", async () => {
    const release = await pickFromHome(surface([DIGEST]));
    await act(async () => release());
    await screen.findByRole("tab", { name: "Digest" });
    await act(async () => {});
    expect(screen.getByRole("tab", { name: "Digest" }).getAttribute("aria-selected")).toBe("true");
  });
});
