import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { BrokerAnswer } from "../src/main/plugin-broker";
import { PluginChannel } from "../src/main/plugin-channel";
import { HOST_IN_FLIGHT, PLUGIN_SCHEME, PluginBackendHost } from "../src/main/plugin-host";
import { PLUGIN_CSP, parsePluginRpc } from "../src/main/plugin-protocol";

vi.mock("../src/main/plugin-protocol", async (orig) => {
  const real = await orig<typeof import("../src/main/plugin-protocol")>();
  return { ...real, parsePluginRpc: vi.fn(real.parsePluginRpc) };
});
const parsed = vi.mocked(parsePluginRpc);

const resources = path.resolve(__dirname, "../resources");

type Listener = (...args: never[]) => unknown;

/** Just enough of Electron for the host: sessions, hidden windows and ipcMain, every call recorded. */
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
    constructor(readonly opts: { webPreferences: Record<string, unknown> }) {
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
  const electron = { BrowserWindow: FakeWindow, session: { fromPartition }, ipcMain };
  /** An invoke from window `w` (its main frame unless `frame` says otherwise). */
  const invoke = (w: FakeWindow, method: unknown, payload: unknown, frame?: { url: string } | null) => {
    const fn = handlers.get("hh-plugin:rpc") as unknown as (e: unknown, m: unknown, p: unknown) => Promise<unknown>;
    const senderFrame = frame === undefined ? w.webContents.mainFrame : frame;
    return fn({ sender: { id: w.webContents.id, mainFrame: w.webContents.mainFrame }, senderFrame }, method, payload);
  };
  return { electron, sessions, windows, handlers, fromPartition, ipcMain, invoke };
}

async function dist(files: Record<string, string> = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hh-pl-host-"));
  const d = path.join(root, "dist");
  await fs.mkdir(d);
  await fs.writeFile(path.join(d, "backend.js"), "export default { sources: {} };\n");
  for (const [f, text] of Object.entries(files)) await fs.writeFile(path.join(d, f), text);
  const real = await fs.realpath(d);
  return { dist: real, backendHash: createHash("sha256").update(await fs.readFile(path.join(real, "backend.js"))).digest("hex") };
}

function setup() {
  const fake = fakeElectron();
  const host = new PluginBackendHost({ resources, devTools: false, electron: fake.electron as never });
  const channel = (ctx: (runId: string, name: string, args: unknown[]) => Promise<BrokerAnswer> = async () => ({ ok: true, value: "v" })) => new PluginChannel({ ctx, idleMs: 25_000 });
  return { fake, host, channel };
}

async function started(id = "oncall", files: Record<string, string> = {}) {
  const t = setup();
  const d = await dist(files);
  const ch = t.channel();
  const gone = vi.fn();
  await t.host.start({ id, ...d, channel: ch, gone });
  const win = t.fake.windows.at(-1)!;
  const ses = t.fake.sessions.get(`hh-plugin-${id}`)!;
  const get = (url: string, method = "GET") => ses.scheme.get("hh-plugin")!(new Request(url, { method }));
  return { ...t, ...d, ch, gone, win, ses, get };
}

describe("the plugin backend host (plugins spec §4.1)", () => {
  it("D0: building the host registers nothing — no partition, no scheme handler, no IPC handler, no window", () => {
    const { fake } = setup();
    expect(fake.fromPartition).not.toHaveBeenCalled();
    expect(fake.ipcMain.handle).not.toHaveBeenCalled();
    expect(fake.windows).toHaveLength(0);
  });

  it("the scheme is privileged as standard and secure only (spike S2)", () => {
    expect(PLUGIN_SCHEME).toEqual({ scheme: "hh-plugin", privileges: { standard: true, secure: true } });
  });

  it("B1: a hidden sandboxed window, no Node, no webview, in an in-memory session of its own, loading the host page", async () => {
    const t = await started();
    expect(t.fake.fromPartition).toHaveBeenCalledWith("hh-plugin-oncall");
    const opts = t.win.opts as { show: boolean; webPreferences: Record<string, unknown> };
    expect(opts.show).toBe(false);
    expect(opts.webPreferences).toMatchObject({
      session: t.ses,
      preload: path.join(resources, "plugin-preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: false,
      nodeIntegrationInWorker: false,
      webviewTag: false,
      devTools: false,
    });
    expect(t.win.webContents.loaded).toEqual(["hh-plugin://oncall/_hh/host.html"]);
  });

  it("B2: navigation, frames, redirects, webviews, new windows, downloads and permissions are all refused", async () => {
    const t = await started();
    for (const ev of ["will-navigate", "will-frame-navigate", "will-redirect", "will-attach-webview"]) {
      const event = { preventDefault: vi.fn() };
      (t.win.webContents.events.get(ev) as unknown as (e: unknown) => void)(event);
      expect(event.preventDefault, ev).toHaveBeenCalled();
    }
    expect((t.win.webContents.openHandler as unknown as () => unknown)()).toEqual({ action: "deny" });
    const dl = { preventDefault: vi.fn() };
    (t.ses.events.get("will-download") as unknown as (e: unknown) => void)(dl);
    expect(dl.preventDefault).toHaveBeenCalled();
    const cb = vi.fn();
    (t.ses.permissionRequest as unknown as (...a: unknown[]) => void)(null, "media", cb);
    expect(cb).toHaveBeenCalledWith(false);
    expect((t.ses.permissionCheck as unknown as () => boolean)()).toBe(false);
    expect((t.ses.devicePermission as unknown as () => boolean)()).toBe(false);
  });

  it("B2, B4: the session cancels every request that isn't one of this plugin's hh-plugin: files", async () => {
    const t = await started();
    const cancel = (url: string) => {
      let out: boolean | undefined;
      t.ses.filter!({ url }, (r) => (out = r.cancel));
      return out;
    };
    expect(cancel("hh-plugin://oncall/backend.js")).toBe(false);
    for (const url of ["http://127.0.0.1:1/x", "https://example.com/", "file:///etc/hosts", "ws://127.0.0.1:1/", "hh-plugin://other/plugin.json", "data:text/plain,x"]) {
      expect(cancel(url), url).toBe(true);
    }
  });

  it("B2, B3: serves the core host files and dist files with the CSP and nosniff; a refusal carries them too", async () => {
    const t = await started("oncall", { "ui.css": "body{}" });
    const host = await t.get("hh-plugin://oncall/_hh/host.html");
    expect(host.status).toBe(200);
    expect(host.headers.get("content-type")).toBe("text/html");
    expect(await host.text()).toContain('src="./host.js"');
    const css = await t.get("hh-plugin://oncall/ui.css");
    expect(await css.text()).toBe("body{}");
    for (const r of [host, css, await t.get("hh-plugin://oncall/..%2f..%2fetc/hosts"), await t.get("hh-plugin://oncall/nope.js"), await t.get("hh-plugin://oncall/ui.css", "POST")]) {
      expect(r.headers.get("content-security-policy")).toBe(PLUGIN_CSP);
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    }
    expect((await t.get("hh-plugin://oncall/..%2f..%2fetc/hosts")).status).toBe(404);
    expect((await t.get("hh-plugin://oncall/ui.css", "POST")).status).toBe(404);
  });

  it("B8: backend.js is the bytes hashed at load, read once; a changed backend.js refuses to start", async () => {
    const t = await started();
    await fs.writeFile(path.join(t.dist, "backend.js"), "export default { sources: { evil: async () => {} } };\n");
    expect(await (await t.get("hh-plugin://oncall/backend.js")).text()).toBe("export default { sources: {} };\n");
    const again = setup();
    await expect(again.host.start({ id: "oncall", dist: t.dist, backendHash: t.backendHash, channel: again.channel(), gone: vi.fn() })).rejects.toThrow(/changed since/);
    expect(again.fake.windows).toHaveLength(0);
  });

  it("B5: the channel is registered once, and answers only a registered window's main frame at its host page", async () => {
    const t = await started();
    await t.host.start({ id: "other", ...(await dist()), channel: t.channel(), gone: vi.fn() });
    expect(t.fake.ipcMain.handle).toHaveBeenCalledTimes(1);
    expect(await t.fake.invoke(t.win, "ready", JSON.stringify({ sources: [] }))).toBeNull();
    // An app page (unknown webContents), a subframe, an error page after a navigation (S9), no frame at all:
    const appPage = new t.fake.electron.BrowserWindow({ webPreferences: {} });
    appPage.webContents.mainFrame.url = "hh-plugin://oncall/_hh/host.html";
    await expect(t.fake.invoke(appPage, "next", "null")).rejects.toThrow("Unexpected sender");
    await expect(t.fake.invoke(t.win, "next", "null", { url: "hh-plugin://oncall/_hh/host.html" })).rejects.toThrow("Unexpected sender");
    t.win.webContents.mainFrame.url = "http://127.0.0.1:1/nav";
    await expect(t.fake.invoke(t.win, "next", "null")).rejects.toThrow("Unexpected sender");
    t.win.webContents.mainFrame.url = "hh-plugin://oncall/_hh/host.html";
    await expect(t.fake.invoke(t.win, "next", "null", null)).rejects.toThrow("Unexpected sender");
  });

  it("B5, B11: the sender is checked before the payload is read; a malformed payload is refused", async () => {
    const t = await started();
    const appPage = new t.fake.electron.BrowserWindow({ webPreferences: {} });
    parsed.mockClear();
    await expect(t.fake.invoke(appPage, "next", "null")).rejects.toThrow("Unexpected sender");
    expect(parsed).not.toHaveBeenCalled();
    await expect(t.fake.invoke(t.win, "next", { not: "a string" })).rejects.toThrow("malformed");
    await expect(t.fake.invoke(t.win, "next", "[[[[")).rejects.toThrow("malformed");
  });

  it("dispatches a checked rpc to the plugin's channel; ctx calls reach the broker", async () => {
    const ctx = vi.fn(async () => ({ ok: true as const, value: 42 }));
    const t = setup();
    const ch = t.channel(ctx);
    await t.host.start({ id: "oncall", ...(await dist()), channel: ch, gone: vi.fn() });
    const win = t.fake.windows[0]!;
    await t.fake.invoke(win, "ready", JSON.stringify({ sources: ["s"] }));
    expect(await ch.ready()).toEqual({ sources: ["s"] });
    const run = ch.run("r1", "s");
    expect(await t.fake.invoke(win, "next", "null")).toEqual({ kind: "run", runId: "r1", source: "s" });
    expect(await t.fake.invoke(win, "ctx", JSON.stringify({ runId: "r1", name: "settings.get", args: [] }))).toEqual({ ok: true, value: 42 });
    expect(ctx).toHaveBeenCalledWith("r1", "settings.get", []);
    await t.fake.invoke(win, "done", JSON.stringify({ runId: "r1", ok: true }));
    await expect(run).resolves.toBeUndefined();
  });

  it("B11: at most HOST_IN_FLIGHT calls per window wait at once; the next one is refused unread", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const ctx = vi.fn(async () => {
      await gate;
      return { ok: true as const, value: null };
    });
    const t = setup();
    const ch = t.channel(ctx);
    await t.host.start({ id: "oncall", ...(await dist()), channel: ch, gone: vi.fn() });
    const win = t.fake.windows[0]!;
    const call = JSON.stringify({ runId: "r", name: "log", args: [] });
    const pending = Array.from({ length: HOST_IN_FLIGHT }, () => t.fake.invoke(win, "ctx", call));
    parsed.mockClear();
    await expect(t.fake.invoke(win, "ctx", call)).rejects.toThrow("Too many calls");
    expect(parsed).not.toHaveBeenCalled();
    release();
    await Promise.all(pending);
    await expect(t.fake.invoke(win, "ctx", call)).resolves.toEqual({ ok: true, value: null });
  });

  it("reload opens a fresh window on the new channel; the old page is an unknown sender and its crash counts nothing", async () => {
    const t = await started();
    const fresh = t.channel();
    const gone2 = vi.fn();
    await t.host.reload({ id: "oncall", channel: fresh, gone: gone2 });
    const win2 = t.fake.windows.at(-1)!;
    expect(win2).not.toBe(t.win);
    expect(t.win.destroyed).toBe(true);
    await expect(t.fake.invoke(t.win, "ready", JSON.stringify({ sources: [] }))).rejects.toThrow("Unexpected sender");
    await t.fake.invoke(win2, "ready", JSON.stringify({ sources: ["s"] }));
    expect(await fresh.ready()).toEqual({ sources: ["s"] });
    (t.win.webContents.events.get("render-process-gone") as unknown as (e: unknown, d: unknown) => void)({}, { reason: "killed" });
    expect(t.gone).not.toHaveBeenCalled();
    expect(gone2).not.toHaveBeenCalled();
    // The backend bytes are the ones read at start: a reload doesn't read the file again.
    await fs.writeFile(path.join(t.dist, "backend.js"), "changed");
    expect(await (await t.get("hh-plugin://oncall/backend.js")).text()).toBe("export default { sources: {} };\n");
  });

  it("render-process-gone and unresponsive go to the crash path of the current window", async () => {
    const t = await started();
    (t.win.webContents.events.get("render-process-gone") as unknown as (e: unknown, d: unknown) => void)({}, { reason: "crashed" });
    expect(t.gone).toHaveBeenCalledWith("crashed");
    (t.win.webContents.events.get("unresponsive") as unknown as () => void)();
    expect(t.gone).toHaveBeenLastCalledWith("unresponsive");
  });

  it("a page that fails to load goes to the crash path", async () => {
    const t = setup();
    const gone = vi.fn();
    const Orig = t.fake.electron.BrowserWindow;
    t.fake.electron.BrowserWindow = class extends Orig {
      constructor(o: { webPreferences: Record<string, unknown> }) {
        super(o);
        this.webContents.loadURL = async () => {
          throw new Error("ERR_FAILED");
        };
      }
    };
    await t.host.start({ id: "oncall", ...(await dist()), channel: t.channel(), gone });
    await new Promise((r) => setTimeout(r, 0));
    expect(gone).toHaveBeenCalledWith("the page did not load");
  });

  it("stop destroys the window: its calls are refused and the scheme serves nothing", async () => {
    const t = await started();
    await t.host.stop("oncall");
    expect(t.win.destroyed).toBe(true);
    await expect(t.fake.invoke(t.win, "next", "null")).rejects.toThrow("Unexpected sender");
    expect((await t.get("hh-plugin://oncall/_hh/host.html")).status).toBe(404);
    // A restart reuses the session without registering its handlers twice.
    await t.host.start({ id: "oncall", dist: t.dist, backendHash: t.backendHash, channel: t.channel(), gone: vi.fn() });
    expect(t.ses.protocol.handle).toHaveBeenCalledTimes(1);
    expect(t.ses.webRequest.onBeforeRequest).toHaveBeenCalledTimes(1);
    await t.host.stopAll();
    expect(t.fake.windows.every((w) => w.destroyed)).toBe(true);
  });
});
