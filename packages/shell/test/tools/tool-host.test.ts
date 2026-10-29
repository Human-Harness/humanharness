import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrokerAnswer } from "../../src/main/broker/broker";
import {
  TOOLS_BUSY,
  TOOLS_OFF,
  TOOL_CALLS_IN_FLIGHT,
  TOOL_RPC_CHANNEL,
  TOOL_RPC_IN_FLIGHT,
  ToolHost,
  type ToolHostAnswer,
} from "../../src/main/tools/tool-host";
import { TOOL_CSP, parseToolRpc } from "../../src/main/tools/tool-protocol";

vi.mock("../../src/main/tools/tool-protocol", async (orig) => {
  const real = await orig<typeof import("../../src/main/tools/tool-protocol")>();
  return { ...real, parseToolRpc: vi.fn(real.parseToolRpc) };
});
const parsed = vi.mocked(parseToolRpc);
const refused = (reason: string) => ({ ok: false, refused: expect.stringContaining(reason) });

const resources = path.resolve(__dirname, "../../resources");

type Listener = (...args: never[]) => unknown;

/** Just enough of Electron for the host (as plugin-host.test.ts): sessions, hidden windows and ipcMain, recorded. */
function fakeElectron() {
  let nextWc = 1;
  const sessions = new Map<string, ReturnType<typeof newSession>>();
  const windows: FakeWindow[] = [];
  const handlers = new Map<string, Listener>();
  const fromPartition = vi.fn((name: string) => {
    let s = sessions.get(name);
    if (!s) sessions.set(name, (s = newSession()));
    return s;
  });
  function newSession() {
    const s = {
      scheme: new Map<string, (req: Request) => Promise<Response>>(),
      filter: null as null | ((d: { url: string }, cb: (r: { cancel: boolean }) => void) => void),
      events: new Map<string, Listener>(),
      permissionRequest: null as null | Listener,
      permissionCheck: null as null | Listener,
      devicePermission: null as null | Listener,
      protocol: { handle: vi.fn((scheme: string, fn: (req: Request) => Promise<Response>) => s.scheme.set(scheme, fn)) },
      webRequest: { onBeforeRequest: vi.fn((_f: unknown, fn: typeof s.filter) => (s.filter = fn)) },
      setPermissionRequestHandler: (fn: Listener) => (s.permissionRequest = fn),
      setPermissionCheckHandler: (fn: Listener) => (s.permissionCheck = fn),
      setDevicePermissionHandler: (fn: Listener) => (s.devicePermission = fn),
      on: (ev: string, fn: Listener) => s.events.set(ev, fn),
    };
    return s;
  }
  class FakeWindow {
    destroyed = false;
    readonly webContents: {
      id: number;
      mainFrame: { url: string };
      events: Map<string, Listener>;
      openHandler: Listener | null;
      loaded: string[];
      setWindowOpenHandler(fn: Listener): void;
      on(ev: string, fn: Listener): void;
      loadURL(url: string): Promise<void>;
    };
    constructor(readonly opts: { show?: boolean; webPreferences: Record<string, unknown> }) {
      const wc = {
        id: nextWc++,
        mainFrame: { url: "" },
        events: new Map<string, Listener>(),
        openHandler: null as Listener | null,
        loaded: [] as string[],
        setWindowOpenHandler: (fn: Listener) => (wc.openHandler = fn),
        on: (ev: string, fn: Listener) => void wc.events.set(ev, fn),
        loadURL: async (url: string) => {
          wc.loaded.push(url);
          wc.mainFrame.url = url;
        },
      };
      this.webContents = wc;
      windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const ipcMain = { handle: vi.fn((ch: string, fn: Listener) => handlers.set(ch, fn)) };
  const defaultSession = newSession();
  const electron = { BrowserWindow: FakeWindow, session: { fromPartition, defaultSession }, ipcMain };
  /** An invoke from window `w` (its main frame unless `frame` says otherwise); the payload as the preload sends it. */
  const invoke = (w: FakeWindow, method: unknown, payload: unknown, frame?: { url: string } | null) => {
    const fn = handlers.get(TOOL_RPC_CHANNEL) as unknown as (e: unknown, m: unknown, p: unknown) => Promise<unknown>;
    const senderFrame = frame === undefined ? w.webContents.mainFrame : frame;
    return fn({ sender: { id: w.webContents.id, mainFrame: w.webContents.mainFrame }, senderFrame }, method, payload);
  };
  return { electron, sessions, windows, handlers, fromPartition, ipcMain, invoke, defaultSession };
}

async function dist() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hh-tool-host-"));
  const d = path.join(root, "dist");
  await fs.mkdir(path.join(d, "tools"), { recursive: true });
  await fs.writeFile(path.join(d, "tools", "count.js"), "export default {};\n");
  await fs.writeFile(path.join(d, "tools.json"), "{}");
  return fs.realpath(d);
}

const emit = (w: { webContents: { events: Map<string, Listener> } }, ev: string, ...args: unknown[]) => (w.webContents.events.get(ev) as unknown as (...a: unknown[]) => void)(...args);
const j = (v: unknown) => JSON.stringify(v);

async function started(o: { ids?: string[]; ctx?: (tool: string, callId: string, name: string, args: unknown[]) => Promise<BrokerAnswer>; now?: () => number } = {}) {
  const fake = fakeElectron();
  const log = vi.fn();
  const host = new ToolHost({ resources, devTools: false, electron: fake.electron as never, log, ...(o.now ? { now: o.now } : {}) });
  const ctx = vi.fn(o.ctx ?? (async () => ({ ok: true as const, value: "v" })));
  const onCrash = vi.fn();
  const onOff = vi.fn();
  const ids = o.ids ?? ["count", "slow"];
  host.start({ harnessId: "demo", dist: await dist(), ids, channel: { ctx }, onCrash, onOff });
  const win = () => fake.windows.at(-1)!;
  const ses = fake.sessions.get("hh-tools-demo")!;
  const get = (url: string, method = "GET") => ses.scheme.get("hh-tools")!(new Request(url, { method }));
  /** The page loads its tools and says so. */
  const ready = (tools = ids, errors: { tool: string; error: string }[] = []) => fake.invoke(win(), "ready", j({ tools, errors }));
  const next = () => fake.invoke(win(), "next", "null") as Promise<{ kind: string; callId?: string; tool?: string; args?: unknown; scope?: string | null }>;
  const done = (v: Record<string, unknown>) => fake.invoke(win(), "done", j(v));
  return { fake, host, ctx, onCrash, onOff, log, win, ses, get, ready, next, done, ids };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("the tool host (tools spec §4.1; T1, T2, T6)", () => {
  it("D0: building the host registers nothing — no partition, no scheme handler, no IPC handler, no window", () => {
    const fake = fakeElectron();
    const host = new ToolHost({ resources, devTools: false, electron: fake.electron as never });
    expect(host.off()).toBeNull();
    expect(fake.fromPartition).not.toHaveBeenCalled();
    expect(fake.ipcMain.handle).not.toHaveBeenCalled();
    expect(fake.windows).toHaveLength(0);
  });

  it("start opens one hidden sandboxed window with the plugin settings (sandbox, contextIsolation, no node, no webview)", async () => {
    const t = await started();
    expect(t.fake.windows).toHaveLength(1);
    expect(t.fake.fromPartition).toHaveBeenCalledWith("hh-tools-demo");
    const opts = t.win().opts as { show: boolean; webPreferences: Record<string, unknown> };
    expect(opts.show).toBe(false);
    expect(opts.webPreferences).toMatchObject({
      session: t.ses,
      preload: path.join(resources, "tool-preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      webSecurity: true,
      disableDialogs: true,
      devTools: false,
    });
    expect(t.win().webContents.loaded).toEqual(["hh-tools://demo/_hh/host.html?tools=count,slow"]);
    // The app window's session is never touched.
    expect(t.fake.defaultSession.protocol.handle).not.toHaveBeenCalled();
    expect(t.fake.defaultSession.webRequest.onBeforeRequest).not.toHaveBeenCalled();
  });

  it("navigation, frames, redirects, webviews, new windows, downloads and permissions are all refused", async () => {
    const t = await started();
    for (const ev of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
      const event = { preventDefault: vi.fn() };
      emit(t.win(), ev, event);
      expect(event.preventDefault, ev).toHaveBeenCalled();
    }
    expect((t.win().webContents.openHandler as unknown as () => unknown)()).toEqual({ action: "deny" });
    const dl = { preventDefault: vi.fn() };
    (t.ses.events.get("will-download") as unknown as (e: unknown) => void)(dl);
    expect(dl.preventDefault).toHaveBeenCalled();
    const cb = vi.fn();
    (t.ses.permissionRequest as unknown as (...a: unknown[]) => void)(null, "media", cb);
    expect(cb).toHaveBeenCalledWith(false);
    expect((t.ses.permissionCheck as unknown as () => boolean)()).toBe(false);
    expect((t.ses.devicePermission as unknown as () => boolean)()).toBe(false);
  });

  it("the session cancels every request that isn't one of this harness's hh-tools: files", async () => {
    const t = await started();
    const cancel = (url: string) => {
      let out: boolean | undefined;
      t.ses.filter!({ url }, (r) => (out = r.cancel));
      return out;
    };
    expect(cancel("hh-tools://demo/tools/count.js")).toBe(false);
    for (const url of ["http://127.0.0.1:1/x", "https://example.com/", "file:///etc/hosts", "ws://127.0.0.1:1/", "hh-tools://other/tools/count.js", "hh-plugin://demo/backend.js", "data:text/javascript,1"]) {
      expect(cancel(url), url).toBe(true);
    }
  });

  it("serves the host page, its script and built tools with the CSP, nosniff and no-store; a refusal carries them too", async () => {
    const t = await started();
    const page = await t.get("hh-tools://demo/_hh/host.html?tools=count,slow");
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toBe("text/html");
    expect(await page.text()).toContain('src="./host.js"');
    const tool = await t.get("hh-tools://demo/tools/count.js");
    expect(await tool.text()).toBe("export default {};\n");
    const misses = [await t.get("hh-tools://demo/tools.json"), await t.get("hh-tools://demo/tools/..%2ftools.json"), await t.get("hh-tools://demo/tools/count.js", "POST")];
    for (const r of [page, tool, ...misses]) {
      expect(r.headers.get("content-security-policy")).toBe(TOOL_CSP);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    expect(misses.map((r) => r.status)).toEqual([404, 404, 404]);
  });

  it("registers hh-tools:rpc once, only at start (D0); a stop and start again registers nothing more", async () => {
    const t = await started();
    expect(t.fake.ipcMain.handle).toHaveBeenCalledTimes(1);
    expect(t.fake.ipcMain.handle).toHaveBeenCalledWith("hh-tools:rpc", expect.any(Function));
    t.host.stop();
    expect(t.win().destroyed).toBe(true);
    expect((await t.get("hh-tools://demo/tools/count.js")).status).toBe(404);
    t.host.start({ harnessId: "demo", dist: await dist(), ids: ["count"], channel: { ctx: t.ctx }, onCrash: t.onCrash, onOff: t.onOff });
    expect(t.fake.ipcMain.handle).toHaveBeenCalledTimes(1);
    expect(t.ses.protocol.handle).toHaveBeenCalledTimes(1);
    expect(t.ses.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    expect(t.fake.windows).toHaveLength(2);
  });

  it("T2: answers only its window's main frame at its own host page; the sender is checked before the payload is read", async () => {
    const t = await started();
    const win = t.win();
    const appPage = new t.fake.electron.BrowserWindow({ webPreferences: {} });
    appPage.webContents.mainFrame.url = "hh-tools://demo/_hh/host.html?tools=count,slow";
    parsed.mockClear();
    expect(await t.fake.invoke(appPage, "next", "null")).toEqual(refused("Unexpected sender"));
    expect(await t.fake.invoke(win, "next", "null", { url: "hh-tools://demo/_hh/host.html?tools=count,slow" })).toEqual(refused("Unexpected sender"));
    expect(await t.fake.invoke(win, "next", "null", null)).toEqual(refused("Unexpected sender"));
    expect(parsed).not.toHaveBeenCalled();
    win.webContents.mainFrame.url = "http://127.0.0.1:1/nav";
    expect(await t.fake.invoke(win, "next", "null")).toEqual(refused("Unexpected sender"));
    win.webContents.mainFrame.url = "hh-tools://demo/_hh/host.html?tools=count,slow";
    expect(await t.fake.invoke(win, "next", { not: "a string" })).toEqual(refused("malformed"));
    expect(await t.fake.invoke(win, "bogus", "null")).toEqual(refused("malformed"));
    // Before `ready`, `next` is refused: only a page that loaded its tools pulls calls.
    expect(await t.fake.invoke(win, "next", "null")).toEqual(refused("not ready"));
  });

  it("a call goes to the page; its ctx calls reach the channel as the call's tool; done answers the value and summary", async () => {
    const t = await started();
    expect(await t.ready()).toBeNull();
    const answer = t.host.call({ callId: "c1", tool: "count", args: { folder: "a" }, scope: "intro" }, 30_000);
    expect(await t.next()).toEqual({ kind: "call", callId: "c1", tool: "count", args: { folder: "a" }, scope: "intro" });
    expect(await t.fake.invoke(t.win(), "ctx", j({ callId: "c1", name: "files.read", args: ["notes.md"] }))).toEqual({ ok: true, value: "v" });
    expect(t.ctx).toHaveBeenCalledWith("count", "c1", "files.read", ["notes.md"]);
    expect(await t.done({ callId: "c1", ok: true, value: { n: 3 }, summary: "3 notes" })).toBeNull();
    expect(await answer).toEqual({ ok: true, value: { n: 3 }, summary: "3 notes" });
    const failing = t.host.call({ callId: "c2", tool: "count", args: {}, scope: null }, 30_000);
    await t.next();
    await t.done({ callId: "c2", ok: false, error: "HTTP 500" });
    expect(await failing).toEqual({ ok: false, error: "HTTP 500" });
  });

  it("T2: a done for a call still queued (not yet handed to the page) is ignored, and the call still runs", async () => {
    const t = await started();
    // Before the page's ready, the call waits in the queue.
    const answer = t.host.call({ callId: "c1", tool: "count", args: {}, scope: null }, 30_000);
    expect(await t.done({ callId: "c1", ok: true, value: "forged" })).toBeNull();
    let settled = false;
    void answer.then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 0));
    expect(settled).toBe(false);
    await t.ready();
    expect(await t.next()).toMatchObject({ kind: "call", callId: "c1", tool: "count" });
    await t.done({ callId: "c1", ok: true, value: "real" });
    expect(await answer).toEqual({ ok: true, value: "real" });
  });

  it("T2: a ctx call naming a call id main didn't hand out, or one already answered, is refused and reaches nothing", async () => {
    const t = await started();
    await t.ready();
    expect(await t.fake.invoke(t.win(), "ctx", j({ callId: "forged", name: "files.read", args: ["x"] }))).toEqual(refused("Unknown tool call"));
    const answer = t.host.call({ callId: "c1", tool: "count", args: {}, scope: null }, 30_000);
    // Queued but not yet handed to the page: not running either.
    expect(await t.fake.invoke(t.win(), "ctx", j({ callId: "c1", name: "files.read", args: ["x"] }))).toEqual(refused("Unknown tool call"));
    await t.next();
    await t.done({ callId: "c1", ok: true, value: 1 });
    await answer;
    expect(await t.fake.invoke(t.win(), "ctx", j({ callId: "c1", name: "files.read", args: ["x"] }))).toEqual(refused("Unknown tool call"));
    // A done for an unknown call changes nothing.
    expect(await t.done({ callId: "forged", ok: true, value: 1 })).toBeNull();
    expect(t.ctx).not.toHaveBeenCalled();
  });

  it("calls wait for the page's ready; a tool that failed to load or isn't built answers its error without reaching the page", async () => {
    const t = await started({ ids: ["count", "broken"] });
    const early = t.host.call({ callId: "c1", tool: "count", args: {}, scope: null }, 30_000);
    const broken = t.host.call({ callId: "c2", tool: "broken", args: {}, scope: null }, 30_000);
    expect(await t.host.call({ callId: "c3", tool: "nope", args: {}, scope: null }, 30_000)).toEqual({ ok: false, error: 'No tool "nope" is built' });
    await t.ready(["count"], [{ tool: "broken", error: "SyntaxError: Unexpected token" }]);
    expect(await broken).toEqual({ ok: false, error: "broken did not load: SyntaxError: Unexpected token" });
    expect(t.log).toHaveBeenCalledWith(expect.stringContaining("broken did not load: SyntaxError: Unexpected token"));
    expect(await t.next()).toMatchObject({ kind: "call", callId: "c1", tool: "count" });
    await t.done({ callId: "c1", ok: true, value: null });
    expect(await early).toEqual({ ok: true, value: null });
  });

  it("a waiting next answers idle after a while, so no invoke stays open for ever", async () => {
    vi.useFakeTimers();
    const t = await started();
    await t.ready();
    const waiting = t.next();
    await vi.advanceTimersByTimeAsync(25_000);
    expect(await waiting).toEqual({ kind: "idle" });
  });

  it("a call times out after the tool's timeout and the host is not restarted for it", async () => {
    vi.useFakeTimers();
    const t = await started();
    await t.ready();
    const answer = t.host.call({ callId: "c1", tool: "slow", args: {}, scope: null }, 5_000);
    await t.next();
    await vi.advanceTimersByTimeAsync(4_999);
    let settled = false;
    void answer.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual({ ok: false, error: "slow took longer than 5 s" });
    // A late done is ignored; its ctx calls are refused from now on; the window stays.
    expect(await t.done({ callId: "c1", ok: true, value: 1 })).toBeNull();
    expect(await t.fake.invoke(t.win(), "ctx", j({ callId: "c1", name: "log", args: ["info", "x"] }))).toEqual(refused("Unknown tool call"));
    expect(t.fake.windows).toHaveLength(1);
    expect(t.win().destroyed).toBe(false);
    expect(t.onCrash).not.toHaveBeenCalled();
    // A call that times out before the page takes it never reaches the page.
    const queued = t.host.call({ callId: "c2", tool: "slow", args: {}, scope: null }, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await queued).toEqual({ ok: false, error: "slow took longer than 1 s" });
    const third = t.host.call({ callId: "c3", tool: "count", args: {}, scope: null }, 1_000);
    expect(await t.next()).toMatchObject({ callId: "c3" });
    await t.done({ callId: "c3", ok: true, value: 3 });
    expect(await third).toEqual({ ok: true, value: 3 });
  });

  it("≤ 32 calls in flight; the 33rd is refused 'Too many tool calls at once'", async () => {
    const t = await started();
    await t.ready();
    expect(TOOL_CALLS_IN_FLIGHT).toBe(32);
    const pending = Array.from({ length: TOOL_CALLS_IN_FLIGHT }, (_, i) => t.host.call({ callId: `c${i}`, tool: "count", args: {}, scope: null }, 30_000));
    expect(await t.host.call({ callId: "c-extra", tool: "count", args: {}, scope: null }, 30_000)).toEqual({ ok: false, error: TOOLS_BUSY });
    expect(TOOLS_BUSY).toBe("Too many tool calls at once");
    for (let i = 0; i < TOOL_CALLS_IN_FLIGHT; i++) {
      const cmd = await t.next();
      await t.done({ callId: cmd.callId, ok: true, value: i });
    }
    await Promise.all(pending);
    const after = t.host.call({ callId: "c-after", tool: "count", args: {}, scope: null }, 30_000);
    await t.next();
    await t.done({ callId: "c-after", ok: true, value: "x" });
    expect(await after).toEqual({ ok: true, value: "x" });
  });

  it("a call id already in flight is refused", async () => {
    const t = await started();
    await t.ready();
    void t.host.call({ callId: "c1", tool: "count", args: {}, scope: null }, 30_000);
    expect(await t.host.call({ callId: "c1", tool: "count", args: {}, scope: null }, 30_000)).toEqual({ ok: false, error: expect.stringContaining("already") });
  });

  it("T6: at most TOOL_RPC_IN_FLIGHT rpc calls wait at once; the next one is refused unread", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = await started({
      ctx: async () => {
        await gate;
        return { ok: true, value: null };
      },
    });
    await t.ready();
    void t.host.call({ callId: "c1", tool: "count", args: {}, scope: null }, 30_000);
    await t.next();
    const call = j({ callId: "c1", name: "log", args: ["info", "x"] });
    const pending = Array.from({ length: TOOL_RPC_IN_FLIGHT }, () => t.fake.invoke(t.win(), "ctx", call));
    parsed.mockClear();
    expect(await t.fake.invoke(t.win(), "ctx", call)).toEqual(refused("Too many calls at once"));
    expect(parsed).not.toHaveBeenCalled();
    release();
    await Promise.all(pending);
    expect(await t.fake.invoke(t.win(), "ctx", call)).toEqual({ ok: true, value: null });
  });

  it("a channel that throws is answered as a refusal, never a throw", async () => {
    const t = await started({
      ctx: async () => {
        throw new Error("broker down");
      },
    });
    await t.ready();
    void t.host.call({ callId: "c1", tool: "count", args: {}, scope: null }, 30_000);
    await t.next();
    expect(await t.fake.invoke(t.win(), "ctx", j({ callId: "c1", name: "log", args: [] }))).toEqual(refused("broker down"));
  });

  it("a crash restarts with backoff 1 s, 2 s, 4 s … ≤ 30 s; calls running in the dead page fail, queued ones wait", async () => {
    vi.useFakeTimers();
    let now = 0;
    const t = await started({ now: () => now });
    await t.ready();
    const running = t.host.call({ callId: "c1", tool: "count", args: {}, scope: null }, 120_000);
    await t.next();
    emit(t.win(), "render-process-gone", {}, { reason: "crashed" });
    expect(await running).toEqual({ ok: false, error: "The tools host stopped (crashed)" });
    expect(t.onCrash).toHaveBeenCalledWith("crashed");
    expect(t.fake.windows[0]!.destroyed).toBe(true);
    // A call made while the host is down waits for the new page.
    const queued = t.host.call({ callId: "c2", tool: "count", args: {}, scope: null }, 120_000);
    const delays: number[] = [];
    // Crashes 20 minutes apart: never 5 within an hour, so the backoff alone grows.
    for (let crash = 1; crash <= 7; crash++) {
      const before = t.fake.windows.length;
      await vi.advanceTimersByTimeAsync(999);
      let waited = 999;
      while (t.fake.windows.length === before) {
        await vi.advanceTimersByTimeAsync(1);
        waited++;
        if (waited > 60_000) throw new Error("no restart");
      }
      delays.push(waited);
      if (crash === 1) {
        await t.ready();
        expect(await t.next()).toMatchObject({ callId: "c2" });
        await t.done({ callId: "c2", ok: true, value: "after" });
        expect(await queued).toEqual({ ok: true, value: "after" });
      }
      if (crash === 7) break;
      now += 20 * 60_000;
      emit(t.win(), "unresponsive");
    }
    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(t.onOff).not.toHaveBeenCalled();
    expect(t.host.off()).toBeNull();
  });

  it("the 5th crash within an hour turns tools off: off() is reported once and every call answers 'Tools are off after repeated crashes'", async () => {
    vi.useFakeTimers();
    let now = 0;
    const t = await started({ now: () => now });
    for (let i = 1; i <= 5; i++) {
      now += 60_000;
      emit(t.win(), "render-process-gone", {}, { reason: "crashed" });
      if (i < 5) await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(TOOLS_OFF).toBe("Tools are off after repeated crashes");
    expect(t.host.off()).toBe(TOOLS_OFF);
    expect(t.onOff).toHaveBeenCalledTimes(1);
    expect(t.onOff).toHaveBeenCalledWith(TOOLS_OFF);
    const windows = t.fake.windows.length;
    await vi.advanceTimersByTimeAsync(120_000);
    expect(t.fake.windows).toHaveLength(windows);
    expect(t.fake.windows.every((w) => w.destroyed)).toBe(true);
    expect(await t.host.call({ callId: "c1", tool: "count", args: {}, scope: null }, 30_000)).toEqual({ ok: false, error: TOOLS_OFF });
    // A late event of a dead window counts nothing more.
    emit(t.fake.windows.at(-1)!, "render-process-gone", {}, { reason: "crashed" });
    expect(t.onOff).toHaveBeenCalledTimes(1);
  });

  it("crashes more than an hour apart never turn tools off", async () => {
    vi.useFakeTimers();
    let now = 0;
    const t = await started({ now: () => now });
    for (let i = 1; i <= 8; i++) {
      now += 61 * 60_000;
      emit(t.win(), "render-process-gone", {}, { reason: "crashed" });
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(t.host.off()).toBeNull();
    expect(t.fake.windows.at(-1)!.destroyed).toBe(false);
  });

  it("only the current window reports: a window closed by stop says nothing; a page that fails to load is a crash", async () => {
    vi.useFakeTimers();
    const t = await started();
    const first = t.win();
    t.host.stop();
    emit(first, "render-process-gone", {}, { reason: "killed" });
    expect(t.onCrash).not.toHaveBeenCalled();

    const fake = fakeElectron();
    const Orig = fake.electron.BrowserWindow;
    fake.electron.BrowserWindow = class extends Orig {
      constructor(o: { webPreferences: Record<string, unknown> }) {
        super(o);
        this.webContents.loadURL = async () => {
          throw new Error("ERR_FAILED");
        };
      }
    };
    const host = new ToolHost({ resources, devTools: false, electron: fake.electron as never, log: vi.fn() });
    const onCrash = vi.fn();
    host.start({ harnessId: "demo", dist: await dist(), ids: ["count"], channel: { ctx: vi.fn() }, onCrash });
    await vi.advanceTimersByTimeAsync(0);
    expect(onCrash).toHaveBeenCalledWith("the page did not load");
    host.stop();
  });

  it("stop fails every pending call, cancels a scheduled restart and answers nothing after", async () => {
    vi.useFakeTimers();
    const t = await started();
    await t.ready();
    const running = t.host.call({ callId: "c1", tool: "count", args: {}, scope: null }, 30_000);
    await t.next();
    const queued = t.host.call({ callId: "c2", tool: "count", args: {}, scope: null }, 30_000);
    t.host.stop();
    const answers: ToolHostAnswer[] = await Promise.all([running, queued]);
    expect(answers).toEqual([
      { ok: false, error: "Tools stopped" },
      { ok: false, error: "Tools stopped" },
    ]);
    expect(await t.fake.invoke(t.win(), "next", "null")).toEqual(refused("Unexpected sender"));
    expect(await t.host.call({ callId: "c3", tool: "count", args: {}, scope: null }, 30_000)).toEqual({ ok: false, error: "Tools stopped" });

    const u = await started();
    emit(u.win(), "render-process-gone", {}, { reason: "crashed" });
    u.host.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(u.fake.windows).toHaveLength(1);
  });

  it("refuses to start for an id that can't be a host name", async () => {
    const fake = fakeElectron();
    const host = new ToolHost({ resources, devTools: false, electron: fake.electron as never });
    expect(() => host.start({ harnessId: "Not/An/Id", dist: "/x", ids: [], channel: { ctx: vi.fn() } })).toThrow(/harness id/);
    expect(fake.ipcMain.handle).not.toHaveBeenCalled();
  });
});
