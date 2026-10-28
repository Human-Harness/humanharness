// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HarnessApp } from "../src";
import type { PluginSurfaceView, PreparedTaskView } from "../src/client";
import { PREPARED_ARM_MS } from "../src/plugins/PreparedTask";
import { FakeClient } from "./fake-client";

// Fake timers that still follow real time (so findBy/waitFor work); `arm` jumps over Start's arming delay.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
const ready = { language: "en" as const, folder: "/Users/me/Documents/Demo", engineId: "claude" };

const TOKEN = "0123456789abcdef0123456789abcdef";
const prepared = (over: Partial<PreparedTaskView> = {}): PreparedTaskView => ({
  token: TOKEN,
  plugin: "on-this-day",
  pluginName: "On this day",
  title: "On this day · Explain this event",
  prompt: "Explain this event from 1903 for someone curious, in a few short paragraphs: Sample event. Say when you're unsure.",
  tier: "light",
  scope: "app",
  expiresAt: "2026-10-28T10:10:00.000Z",
  ...over,
});
const surface = (over: Partial<PluginSurfaceView> = {}): PluginSurfaceView => ({ panels: [], chips: [], reloads: {}, ...over });

function makeClient(opts: { plugins?: boolean; view?: PluginSurfaceView; scopes?: boolean } = {}) {
  const c = new FakeClient(ready);
  if (opts.plugins !== false) c.state.plugins = { local: true };
  if (opts.scopes) {
    c.state.scopes = { label: "topic", plural: "topics" };
    c.scopeList = [{ id: "fracciones", title: "Fractions", createdAt: "c", archived: false }];
  }
  if (opts.view) c.surfaceView = opts.view;
  return c;
}
async function open(c: FakeClient) {
  render(<HarnessApp client={c} />);
  const start = (await screen.findByRole("button", { name: "Start Demo" })) as HTMLButtonElement;
  await waitFor(() => expect(start.disabled).toBe(false));
  fireEvent.click(start);
  await screen.findByRole("textbox");
  await screen.findByRole("button", { name: "History" });
}
const card = () => screen.queryByRole("region", { name: "Prepared task" });
const startButton = (r: HTMLElement) => within(r).getByRole("button", { name: "Start" }) as HTMLButtonElement;
/** Lets Start's arming delay pass. */
const arm = () => act(() => vi.advanceTimersByTime(PREPARED_ARM_MS));
const starts = (c: FakeClient) => c.pluginCalls.filter((x) => x[0] === "startPrepared");
/** The main column's children, by tag and class: what sits around the composer. */
const mainShape = () => [...(document.querySelector(".hh-main")?.children ?? [])].map((e) => `${e.tagName}.${e.className}`);

describe("prepared-task card", () => {
  it("D0: without state.plugins there is no card, nothing is asked, and the composer area is as before", async () => {
    const c = makeClient({ plugins: false, view: surface({ prepared: prepared() }) });
    const get = vi.spyOn(c.plugins, "surface");
    await open(c);
    expect(card()).toBeNull();
    expect(get).not.toHaveBeenCalled();
    const before = mainShape();
    cleanup();
    // With plugins but nothing prepared, the same column.
    const p = makeClient();
    const got = vi.spyOn(p.plugins, "surface");
    await open(p);
    await waitFor(() => expect(got).toHaveBeenCalled());
    expect(card()).toBeNull();
    expect(mainShape()).toEqual(before);
  });

  it("P9/P13: shows the title, who proposed it, the tier and exactly the prompt, as text", async () => {
    const prompt = "Explain <b>this</b> <img src=x onerror=alert(1)>\n\n  second line\twith a tab";
    const c = makeClient({ view: surface({ prepared: prepared({ prompt, pluginName: "<i>On</i>", title: "<b>T</b> · Explain" }) }) });
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    const pre = r.querySelector("pre") as HTMLPreElement;
    expect(pre.textContent).toBe(prompt);
    expect(pre.getAttribute("dir")).toBe("auto");
    expect(within(r).getByText("<b>T</b> · Explain")).toBeTruthy();
    expect(r.textContent).toContain("Proposed by ⁨<i>On</i>⁩");
    expect(within(r).getByText("Model tier: Light")).toBeTruthy();
    expect(r.querySelector("b, i, img")).toBeNull();
    // Above the composer.
    expect(r.nextElementSibling?.className).toBe("hh-composer");
    expect(starts(c)).toEqual([]);
  });

  it("P6: a surface push with a prepared task makes no client call; Start calls startPrepared once, even on a double click", async () => {
    const c = makeClient();
    await open(c);
    const calls = c.pluginCalls.length;
    act(() => c.emitSurface(surface({ prepared: prepared() })));
    const r = await screen.findByRole("region", { name: "Prepared task" });
    await act(async () => {});
    expect(c.pluginCalls.length).toBe(calls);
    c.pluginResults = [{ ok: true }];
    let resolve!: () => void;
    const spy = vi.spyOn(c.plugins, "startPrepared").mockImplementation(
      () => new Promise((r2) => (resolve = () => r2({ ok: true }))),
    );
    arm();
    const b = startButton(r);
    fireEvent.click(b);
    fireEvent.click(b);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(TOKEN);
    expect(b.disabled).toBe(true);
    await act(async () => resolve());
    // Started: it stays disabled until main's push takes the card away.
    expect(b.disabled).toBe(true);
    act(() => c.emitSurface(surface()));
    await waitFor(() => expect(card()).toBeNull());
  });

  it("a refused Start shows main's message and keeps the card", async () => {
    const c = makeClient({ view: surface({ prepared: prepared() }) });
    c.pluginResults = [{ ok: false, message: "Wait until the answer ends" }];
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    arm();
    fireEvent.click(startButton(r));
    expect((await within(r).findByRole("alert")).textContent).toBe("Wait until the answer ends");
    expect(card()).toBe(r);
    expect(startButton(r).disabled).toBe(false);
    expect(starts(c)).toEqual([["startPrepared", TOKEN]]);
  });

  it("Start puts its task on screen at once, the card's title as the person's line; a refusal takes the line back", async () => {
    const userLines = () => [...document.querySelectorAll('[data-role="user"]')].map((e) => e.textContent ?? "");
    const startView = () => document.querySelector(".hh-start-view");
    // A harness with a path (flow mode): its start page shows until a task goes on screen.
    const withPath = (x: FakeClient) => {
      x.state.actions = { manifest: { label: "The manifest", cost: "light" } };
      return x;
    };
    const c = withPath(makeClient({ view: surface({ prepared: prepared() }) }));
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    await waitFor(() => expect(startView()).not.toBeNull());
    // main answers only once the turn ended: the line must not wait for it.
    const spy = vi.spyOn(c.plugins, "startPrepared").mockImplementation(() => new Promise(() => {}));
    arm();
    fireEvent.click(startButton(r));
    expect(spy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(userLines()).toEqual([expect.stringContaining("On this day · Explain this event")]));
    expect(startView()).toBeNull();
    cleanup();

    const refused = withPath(makeClient({ view: surface({ prepared: prepared() }) }));
    refused.pluginResults = [{ ok: false, message: "This task is no longer prepared" }];
    await open(refused);
    const r2 = await screen.findByRole("region", { name: "Prepared task" });
    await waitFor(() => expect(startView()).not.toBeNull());
    arm();
    fireEvent.click(startButton(r2));
    await within(r2).findByRole("alert");
    expect(userLines()).toEqual([]);
    expect(startView()).not.toBeNull();
  });

  it("a refusal clears the turn it put on screen: the composer sends again", async () => {
    const c = makeClient({ view: surface({ prepared: prepared() }) });
    c.pluginResults = [{ ok: false, message: "Wait until the answer ends" }];
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    arm();
    fireEvent.click(startButton(r));
    await within(r).findByRole("alert");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Something else" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(c.sent).toEqual(["Something else"]));
  });

  it("a Start that fails after main took it keeps the person's line, shows the failure, and frees the composer", async () => {
    const userLines = () => [...document.querySelectorAll('[data-role="user"]')].map((e) => e.textContent ?? "");
    const c = makeClient({ view: surface({ prepared: prepared() }) });
    c.pluginResults = [{ ok: false, message: "Something went wrong", started: true }];
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    arm();
    fireEvent.click(startButton(r));
    await within(r).findByRole("alert");
    // The turn may have run (main saved the line): it stays, and the chat shows the turn failed.
    expect(userLines()).toEqual([expect.stringContaining("On this day · Explain this event")]);
    await waitFor(() => expect(document.querySelector('[data-role="assistant"]')).not.toBeNull());
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Try again" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(c.sent).toEqual(["Try again"]));
  });

  it("Cancel calls cancelPrepared with the token", async () => {
    const c = makeClient({ view: surface({ prepared: prepared() }) });
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    fireEvent.click(within(r).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(c.pluginCalls).toContainEqual(["cancelPrepared", TOKEN]));
    expect(starts(c)).toEqual([]);
  });

  it("Start is disabled while a turn runs", async () => {
    const c = makeClient({ view: surface({ prepared: prepared() }) });
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    arm();
    expect(startButton(r).disabled).toBe(false);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "go" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    act(() => c.emit({ type: "text", delta: "Working on it" }));
    await screen.findByRole("button", { name: "Stop" });
    expect(startButton(r).disabled).toBe(true);
  });

  it("a card that needs the open scope waits for one: disabled with a hint, enabled once a scope is open", async () => {
    const c = makeClient({ scopes: true, view: surface({ prepared: prepared({ scope: "open" }) }) });
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    expect(within(r).getByText("Open a topic first")).toBeTruthy();
    expect(startButton(r).disabled).toBe(true);
    c.openScope = "fracciones";
    act(() => c.emitScopes());
    // The chat (and the card with it) is drawn afresh for the scope: read it again. Its arming delay starts in the new
    // card's mount effect, which React may run on a later macrotask than the render waitFor saw: wait for that effect
    // (it fills the status line too), or `arm` could move the clock before the delay exists.
    await waitFor(() => expect(within(card() as HTMLElement).queryByText("Open a topic first")).toBeNull());
    await waitFor(() => expect(within(card() as HTMLElement).getByRole("status").textContent).not.toBe(""));
    arm();
    expect(startButton(card() as HTMLElement).disabled).toBe(false);
  });

  it("an app-wide card in a harness with scopes needs no open scope", async () => {
    const c = makeClient({ scopes: true, view: surface({ prepared: prepared({ scope: "app" }) }) });
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    arm();
    expect(startButton(r).disabled).toBe(false);
    expect(within(r).queryByText("Open a topic first")).toBeNull();
  });

  it("says that the open task will close", async () => {
    const c = makeClient({ view: surface({ prepared: prepared() }) });
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    expect(within(r).queryByText("Starting it closes the open task.")).toBeNull();
    act(() => c.emitTasks({ current: { id: "t1", status: "waiting" }, actions: {}, notes: [] }));
    expect(await within(r).findByText("Starting it closes the open task.")).toBeTruthy();
  });

  it("a newer card replaces the old one with a fresh state", async () => {
    const c = makeClient({ view: surface({ prepared: prepared() }) });
    c.pluginResults = [{ ok: false, message: "This task is no longer prepared" }];
    await open(c);
    const r = await screen.findByRole("region", { name: "Prepared task" });
    arm();
    fireEvent.click(startButton(r));
    await within(r).findByRole("alert");
    const other = "fedcba9876543210fedcba9876543210";
    act(() => c.emitSurface(surface({ prepared: prepared({ token: other, prompt: "Another" }) })));
    const r2 = await screen.findByRole("region", { name: "Prepared task" });
    await waitFor(() => expect(r2.querySelector("pre")?.textContent).toBe("Another"));
    expect(within(r2).queryByRole("alert")).toBeNull();
  });

  it("P6/P13: Start arms only a moment after a card appears, and a replacing card arms afresh", async () => {
    const c = makeClient();
    await open(c);
    // From here the clock moves only when told (a slow run must not arm the card early); the card renders within act.
    vi.useFakeTimers();
    act(() => c.emitSurface(surface({ prepared: prepared() })));
    const r = card() as HTMLElement;
    expect(r).not.toBeNull();
    expect(startButton(r).disabled).toBe(true);
    fireEvent.click(startButton(r));
    act(() => vi.advanceTimersByTime(PREPARED_ARM_MS - 50));
    expect(startButton(r).disabled).toBe(true);
    act(() => vi.advanceTimersByTime(50));
    expect(startButton(r).disabled).toBe(false);
    // The plugin swaps in another prompt: Start is off again under the pointer, and arms after the same delay.
    const other = "fedcba9876543210fedcba9876543210";
    act(() => c.emitSurface(surface({ prepared: prepared({ token: other, prompt: "Another" }) })));
    expect(card()?.querySelector("pre")?.textContent).toBe("Another");
    const r2 = card() as HTMLElement;
    expect(startButton(r2).disabled).toBe(true);
    fireEvent.click(startButton(r2));
    arm();
    expect(startButton(r2).disabled).toBe(false);
    expect(starts(c)).toEqual([]);
  });

  it("a new card is announced politely, and focus stays in the composer: Enter there starts nothing", async () => {
    const c = makeClient();
    await open(c);
    const box = screen.getByRole("textbox");
    box.focus();
    expect(document.activeElement).toBe(box);
    act(() => c.emitSurface(surface({ prepared: prepared() })));
    const r = await screen.findByRole("region", { name: "Prepared task" });
    const status = within(r).getByRole("status");
    await waitFor(() => expect(status.textContent).toBe("Prepared task from ⁨On this day⁩"));
    arm();
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: "Enter" });
    await act(async () => {});
    expect(document.activeElement).toBe(box);
    expect(starts(c)).toEqual([]);
  });
});
