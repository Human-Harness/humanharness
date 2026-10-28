// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALL_TIMEOUT_MS, Clock, clockText, mountPanel, PanelBridge, PluginRoot, Table, usePlugin, useQuery } from "../src/plugin-ui";

type Posted = { msg: Record<string, unknown>; target: string };

/** The app window, as the panel sees it: an object that records what the panel posts. */
let parent: { posted: Posted[]; postMessage: (msg: Record<string, unknown>, target: string) => void };
let bridge: PanelBridge;

beforeEach(() => {
  const posted: Posted[] = [];
  parent = { posted, postMessage: (msg, target) => posted.push({ msg, target }) };
  Object.defineProperty(window, "parent", { value: parent, configurable: true });
  bridge = new PanelBridge(window);
});
afterEach(() => {
  cleanup();
  bridge.dispose();
  vi.useRealTimers();
  Reflect.deleteProperty(window, "parent");
});

/** A message reaching the panel; from the app window unless `source` says otherwise. */
function fromApp(data: unknown, source: unknown = parent) {
  window.dispatchEvent(new MessageEvent("message", { data, source: source as MessageEventSource, origin: "null" }));
}
const calls = (name?: string) => parent.posted.map((p) => p.msg).filter((m) => m.call !== "resize" && (name === undefined || m.call === name));

describe("the panel bridge (Decision 7)", () => {
  it("a call posts { hh: 1, id, call, args } to the parent with target *", () => {
    void bridge.call("settings.get", {});
    expect(parent.posted).toEqual([{ msg: { hh: 1, id: 1, call: "settings.get", args: {} }, target: "*" }]);
  });

  it("an answer with the call's re, from the parent, resolves it", async () => {
    const p = bridge.call("data.query", { collection: "queues" });
    fromApp({ hh: 1, re: 1, ok: true, value: [{ id: "a" }] });
    await expect(p).resolves.toEqual([{ id: "a" }]);
  });

  it("the same answer from another source is ignored", async () => {
    vi.useFakeTimers();
    const p = bridge.call("data.query", { collection: "queues" });
    const settled = vi.fn();
    p.then(settled, settled);
    fromApp({ hh: 1, re: 1, ok: true, value: "forged" }, window);
    fromApp({ hh: 1, re: 1, ok: true, value: "forged" }, {});
    fromApp({ hh: 1, re: 1, ok: true, value: "forged" }, null);
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).not.toHaveBeenCalled();
    fromApp({ hh: 1, re: 1, ok: true, value: "real" });
    await expect(p).resolves.toBe("real");
  });

  it("a message without hh: 1 or with another re is ignored", async () => {
    vi.useFakeTimers();
    const settled = vi.fn();
    bridge.call("settings.get").then(settled, settled);
    fromApp({ re: 1, ok: true, value: 1 });
    fromApp({ hh: 2, re: 1, ok: true, value: 1 });
    fromApp({ hh: 1, re: 99, ok: true, value: 1 });
    fromApp("hh");
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).not.toHaveBeenCalled();
  });

  it("an ok: false answer rejects with its error", async () => {
    const p = bridge.call("refresh", { source: "x" });
    fromApp({ hh: 1, re: 1, ok: false, error: "Unknown source" });
    await expect(p).rejects.toThrow("Unknown source");
  });

  it("an unanswered call rejects after 15 s", async () => {
    vi.useFakeTimers();
    const p = bridge.call("settings.get");
    const rejected = vi.fn();
    p.catch(rejected);
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1);
    expect(rejected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(rejected).toHaveBeenCalledWith(expect.objectContaining({ message: "The app didn't answer" }));
    // A late answer changes nothing.
    fromApp({ hh: 1, re: 1, ok: true, value: 1 });
  });

  it("a call over 64 KB fails at once, without posting", async () => {
    await expect(bridge.call("data.query", { collection: "x".repeat(70_000) })).rejects.toThrow("Too large");
    expect(parent.posted).toEqual([]);
  });

  it("events reach listeners only from the parent, and only well-formed", () => {
    const seen = vi.fn();
    bridge.on(seen);
    fromApp({ hh: 1, event: "focus", focus: "e1" }, {});
    fromApp({ hh: 1, event: "focus", focus: 3 });
    fromApp({ hh: 1, event: "data", collections: "queues" });
    fromApp({ hh: 1, event: "nope" });
    expect(seen).not.toHaveBeenCalled();
    fromApp({ hh: 1, event: "focus", focus: "e1" });
    expect(seen).toHaveBeenCalledWith({ event: "focus", focus: "e1" });
    expect(bridge.focus).toBe("e1");
  });
});

describe("usePlugin and useQuery", () => {
  function Rows({ collection }: { collection: string }) {
    const q = useQuery<{ id: string }>(collection);
    return <p>{q.rows ? q.rows.map((r) => r.id).join(",") : q.error ?? "loading"}</p>;
  }
  const answerLast = (value: unknown) => {
    const last = calls("data.query").at(-1);
    fromApp({ hh: 1, re: last?.id, ok: true, value });
  };

  it("useQuery reads the collection and reads it again on a data event naming it, not on others", async () => {
    render(
      <PluginRoot bridge={bridge}>
        <Rows collection="queues" />
      </PluginRoot>,
    );
    await waitFor(() => expect(calls("data.query")).toHaveLength(1));
    expect(calls("data.query")[0].args).toEqual({ collection: "queues" });
    act(() => answerLast([{ id: "a" }]));
    await screen.findByText("a");

    act(() => fromApp({ hh: 1, event: "data", collections: ["incidents"] }));
    act(() => fromApp({ hh: 1, event: "data", collections: ["queues"] }, {}));
    await new Promise((r) => setTimeout(r, 20));
    expect(calls("data.query")).toHaveLength(1);

    act(() => fromApp({ hh: 1, event: "data", collections: ["incidents", "queues"] }));
    await waitFor(() => expect(calls("data.query")).toHaveLength(2));
    act(() => answerLast([{ id: "a" }, { id: "b" }]));
    await screen.findByText("a,b");
  });

  it("useQuery shows the error of a refused read", async () => {
    render(
      <PluginRoot bridge={bridge}>
        <Rows collection="other" />
      </PluginRoot>,
    );
    await waitFor(() => expect(calls("data.query")).toHaveLength(1));
    act(() => fromApp({ hh: 1, re: calls("data.query")[0].id, ok: false, error: "Unknown collection" }));
    await screen.findByText("Unknown collection");
  });

  it("focus and theme events update the hook", async () => {
    function Probe() {
      const p = usePlugin();
      return (
        <p>
          {p.focus ?? "none"} {p.theme}
        </p>
      );
    }
    const { container } = render(
      <PluginRoot bridge={bridge}>
        <Probe />
      </PluginRoot>,
    );
    await screen.findByText("none light");
    act(() => fromApp({ hh: 1, event: "focus", focus: "1903" }));
    await screen.findByText("1903 light");
    act(() => fromApp({ hh: 1, event: "theme", dark: true }));
    await screen.findByText("1903 dark");
    expect(container.querySelector(".hhp-root")?.getAttribute("data-theme")).toBe("dark");
  });

  it("settings, refresh and requestAction post the calls main expects", async () => {
    let api: ReturnType<typeof usePlugin> | undefined;
    function Grab() {
      api = usePlugin();
      return null;
    }
    render(
      <PluginRoot bridge={bridge}>
        <Grab />
      </PluginRoot>,
    );
    await waitFor(() => expect(api).toBeDefined());
    const s = api!.settings();
    const r = api!.refresh("events");
    const a = api!.requestAction("explain", { year: 1903, text: "x" });
    expect(calls().map((m) => [m.call, m.args])).toEqual([
      ["settings.get", {}],
      ["refresh", { source: "events" }],
      ["requestAction", { action: "explain", vars: { year: 1903, text: "x" } }],
    ]);
    const [c1, c2, c3] = calls();
    fromApp({ hh: 1, re: c1.id, ok: true, value: { count: 25 } });
    fromApp({ hh: 1, re: c2.id, ok: true, value: "skipped" });
    fromApp({ hh: 1, re: c3.id, ok: true, value: null });
    await expect(s).resolves.toEqual({ count: 25 });
    await expect(r).resolves.toBe("skipped");
    await expect(a).resolves.toBeNull();
  });
});

describe("mountPanel and PluginRoot", () => {
  it("renders the component into #root", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    function Panel() {
      return <p>hello panel</p>;
    }
    const root = mountPanel(Panel, { bridge });
    await screen.findByText("hello panel");
    expect(document.querySelector("#root .hhp-root")).not.toBeNull();
    act(() => root.unmount());
  });

  it("reports its height with a resize message, never waiting for an answer", async () => {
    render(
      <PluginRoot bridge={bridge}>
        <p>x</p>
      </PluginRoot>,
    );
    await waitFor(() => expect(parent.posted.some((p) => p.msg.call === "resize")).toBe(true));
    const resize = parent.posted.find((p) => p.msg.call === "resize")!.msg;
    expect(resize).toEqual({ hh: 1, id: expect.any(Number), call: "resize", args: { height: expect.any(Number) } });
  });
});

describe("components", () => {
  it("Table renders cell text as text, never markup (P9)", () => {
    const { container } = render(
      <Table
        columns={[
          { key: "year", label: "Year" },
          { key: "text", label: "Event" },
        ]}
        rows={[{ id: "1", year: 1903, text: "<b>x</b><img src=x onerror=alert(1)>" }]}
      />,
    );
    expect(screen.getByText("<b>x</b><img src=x onerror=alert(1)>")).toBeTruthy();
    expect(container.querySelector("b")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByText("1903")).toBeTruthy();
  });

  it("Table's row button calls back with its row; no rows shows the empty text", () => {
    const onClick = vi.fn();
    const rows = [{ id: "a", text: "one" }];
    const { rerender } = render(<Table columns={[{ key: "text", label: "Text" }]} rows={rows} action={{ label: "Explain", onClick }} empty="Nothing yet" />);
    screen.getByRole("button", { name: "Explain" }).click();
    expect(onClick).toHaveBeenCalledWith(rows[0]);
    rerender(<Table columns={[{ key: "text", label: "Text" }]} rows={[]} empty="Nothing yet" />);
    expect(screen.getByText("Nothing yet")).toBeTruthy();
  });

  it("Clock shows the time in its zone, and a dash for an unknown zone", () => {
    const at = new Date("2026-10-28T12:34:00Z");
    expect(clockText("UTC", at)).toMatch(/12.34/);
    expect(clockText("Asia/Tokyo", at)).toMatch(/21.34/);
    expect(clockText("Not/AZone", at)).toBeNull();
    render(<Clock zone="Not/AZone" label="Nowhere" />);
    expect(screen.getByText("—")).toBeTruthy();
  });
});
