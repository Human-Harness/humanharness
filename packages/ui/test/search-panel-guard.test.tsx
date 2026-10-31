// @vitest-environment happy-dom
// happy-dom can't fetch hh-plugin:, so it doesn't navigate child frames here; each frame still fires one `load`.
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
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

describe("a plugin record's panel from search (search spec §3 Data)", () => {
  it("a row whose panel is no longer on screen opens nothing, and the panel coming back later isn't pulled forward", async () => {
    const c = new FakeClient(ready);
    c.state.plugins = { local: true };
    c.surfaceView = surface([DIGEST]);
    c.searchAnswers.inc = answer("inc", [INCIDENT]);
    render(<HarnessApp client={c} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await screen.findByRole("region", { name: "Plugins" });
    act(() => c.search.open("inc"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.click(await within(dialog).findByRole("option"));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Search" })).toBeNull());
    act(() => c.emitSurface(surface([DIGEST, QUEUE])));
    await screen.findByRole("tab", { name: "Queue" });
    await act(async () => {});
    expect(screen.getByRole("tab", { name: "Digest" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Queue" }).getAttribute("aria-selected")).toBe("false");
  });

  it("a row whose panel is on screen opens it", async () => {
    const c = new FakeClient(ready);
    c.state.plugins = { local: true };
    c.surfaceView = surface([DIGEST, QUEUE]);
    c.searchAnswers.inc = answer("inc", [INCIDENT]);
    render(<HarnessApp client={c} />);
    const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
    await waitFor(() => expect(start.disabled).toBe(false));
    fireEvent.click(start);
    await screen.findByRole("tab", { name: "Queue" });
    act(() => c.search.open("inc"));
    const dialog = await screen.findByRole("dialog", { name: "Search" });
    fireEvent.click(await within(dialog).findByRole("option"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Queue" }).getAttribute("aria-selected")).toBe("true"));
  });
});
