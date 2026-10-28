import { createHash } from "node:crypto";
import path from "node:path";
import { PLUGIN_ID } from "@humanharness/harness-sdk";
import type { BrowserWindow as ElectronWindow, IpcMainInvokeEvent, Session } from "electron";
import type { PluginChannel } from "./plugin-channel";
import { PLUGIN_CSP, allowPluginRequest, parsePluginRpc, pluginHostUrl, pluginOfSender, readPluginFile, resolvePluginFile } from "./plugin-protocol";
import type { BackendHost } from "./plugins";

/**
 * The plugin backend windows (plugins spec §4.1; Decision 10; threat model B1–B5): one hidden, sandboxed Chromium
 * window per running plugin, in an in-memory session of its own, served only by the `hh-plugin:` scheme. The only
 * module that touches BrowserWindow, session and the plugin channel: everything it decides is in plugin-protocol.ts
 * (pure, unit-tested); this file only plugs it into Electron. Plugin code is hostile: identity comes from the sender
 * (the window's webContents and its main frame), never from what the page says.
 *
 * D0: nothing happens until the first `start`: no partition, no scheme handler, no listener, no IPC handler.
 */

/** For `protocol.registerSchemesAsPrivileged` before the app is ready (spike S2): no fetch, CORS or CSP bypass. */
export const PLUGIN_SCHEME = { scheme: "hh-plugin", privileges: { standard: true, secure: true } } as const;

/** The plugin channel (B5): answers only a registered backend window's main frame at its own host page. */
export const PLUGIN_RPC_CHANNEL = "hh-plugin:rpc";

/**
 * The most `rpc` calls one window may have unanswered (B11), counted before a payload is parsed: the broker's 16
 * `ctx` calls, the waiting `next`, and room for `done`/`ready`. Beyond it a call is refused unread.
 */
export const HOST_IN_FLIGHT = 24;

const HEADERS = { "content-security-policy": PLUGIN_CSP, "x-content-type-options": "nosniff", "cache-control": "no-store" } as const;

export interface PluginHostDeps {
  /** packages/shell/resources (beside out/, like the Dock icon): the preload and the core host page and script. */
  resources: string;
  /** Development builds only. */
  devTools: boolean;
  electron: Pick<typeof import("electron"), "BrowserWindow" | "session" | "ipcMain">;
  log?(message: string, err?: unknown): void;
}

interface Live {
  dist: string;
  /** backend.js as it was hashed when the plugin loaded, read once: the only bytes served as backend.js (B8). */
  backend: Buffer;
  /** Its real path, to recognise a request for it. */
  backendFile: string;
  channel: PluginChannel;
  gone(reason: string): void;
}

export class PluginBackendHost implements BackendHost {
  private readonly live = new Map<string, Live>();
  private readonly windows = new Map<string, ElectronWindow>();
  /** webContents id → plugin id, for the current window of each plugin only. */
  private readonly senders = new Map<number, string>();
  private readonly inFlight = new Map<number, number>();
  private readonly sessions = new Set<string>();
  private channelRegistered = false;

  constructor(private readonly d: PluginHostDeps) {}

  async start(p: { id: string; dist: string; backendHash: string; channel: PluginChannel; gone(reason: string): void }): Promise<void> {
    if (!PLUGIN_ID.test(p.id)) throw new Error("Not a plugin id");
    const backend = await this.readBackend(p.id, p.dist, p.backendHash);
    this.closeWindow(p.id);
    this.live.set(p.id, { dist: p.dist, ...backend, channel: p.channel, gone: p.gone });
    this.registerChannel();
    this.openWindow(p.id, this.sessionOf(p.id));
  }

  /** A fresh window on the same session (a run over the limit): the old page's calls come from a dead sender. */
  async reload(p: { id: string; channel: PluginChannel; gone(reason: string): void }): Promise<void> {
    const live = this.live.get(p.id);
    if (!live) throw new Error("The plugin's backend is not running");
    this.closeWindow(p.id);
    live.channel = p.channel;
    live.gone = p.gone;
    this.openWindow(p.id, this.sessionOf(p.id));
  }

  async stop(id: string): Promise<void> {
    this.closeWindow(id);
    this.live.delete(id);
  }

  async stopAll(): Promise<void> {
    for (const id of [...this.live.keys()]) await this.stop(id);
  }

  /** backend.js through the scheme's own reader, checked against the hash taken when the plugin loaded. */
  private async readBackend(id: string, dist: string, backendHash: string): Promise<{ backend: Buffer; backendFile: string }> {
    const url = `hh-plugin://${id}/backend.js`;
    const o = { id, dist, core: this.d.resources };
    const hit = await resolvePluginFile(url, o);
    const read = await readPluginFile(url, o);
    if (!hit || !read) throw new Error("backend.js can't be read");
    if (createHash("sha256").update(read.body).digest("hex") !== backendHash) throw new Error("backend.js changed since the plugin loaded");
    return { backend: Buffer.from(read.body), backendFile: hit.file };
  }

  /** The plugin's in-memory session (no `persist:`), set up once: its scheme, its request filter, no permissions. */
  private sessionOf(id: string): Session {
    const ses = this.d.electron.session.fromPartition(`hh-plugin-${id}`);
    if (this.sessions.has(id)) return ses;
    this.sessions.add(id);
    ses.protocol.handle("hh-plugin", (req) => this.serve(id, req));
    // B2, B4 (spike S4): every request that isn't one of this plugin's own hh-plugin: files is cancelled.
    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => callback({ cancel: !allowPluginRequest(details.url, id) }));
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    return ses;
  }

  /** One hh-plugin: response; every one, a refusal included, carries the CSP and nosniff (B2, spike S3). */
  private async serve(id: string, req: Request): Promise<Response> {
    const notFound = () => new Response(null, { status: 404, headers: HEADERS });
    try {
      const live = this.live.get(id);
      if (!live || req.method !== "GET") return notFound();
      const o = { id, dist: live.dist, core: this.d.resources };
      const hit = await resolvePluginFile(req.url, o);
      if (!hit) return notFound();
      if (hit.file === live.backendFile) return new Response(new Uint8Array(live.backend), { headers: { ...HEADERS, "content-type": "text/javascript" } });
      const read = await readPluginFile(req.url, o);
      if (!read) return notFound();
      return new Response(new Uint8Array(read.body), { headers: { ...HEADERS, "content-type": read.type } });
    } catch (err) {
      this.d.log?.(`${id}: a plugin file could not be served`, err);
      return notFound();
    }
  }

  private openWindow(id: string, ses: Session): void {
    const win = new this.d.electron.BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      skipTaskbar: true,
      webPreferences: {
        session: ses,
        preload: path.join(this.d.resources, "plugin-preload.cjs"),
        // B1: no Node, no Electron, nothing but the preload's hh.rpc.
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        webSecurity: true,
        allowRunningInsecureContent: false,
        spellcheck: false,
        backgroundThrottling: false,
        devTools: this.d.devTools,
        disableDialogs: true,
        navigateOnDragDrop: false,
      },
    });
    const wc = win.webContents;
    this.windows.set(id, win);
    this.senders.set(wc.id, id);
    // B2 (spike S6): the page never leaves its host page, opens nothing and downloads nothing. A load the app starts
    // (loadURL) fires none of these.
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (event) => event.preventDefault());
    wc.on("will-frame-navigate", (event) => event.preventDefault());
    wc.on("will-redirect", (event) => event.preventDefault());
    wc.on("will-attach-webview", (event) => event.preventDefault());
    // The crash path (spike S7): the controller restarts or turns the plugin off.
    wc.on("render-process-gone", (_event, details) => this.wentAway(id, win, details.reason));
    wc.on("unresponsive", () => this.wentAway(id, win, "unresponsive"));
    wc.loadURL(pluginHostUrl(id)).catch((err: unknown) => {
      this.d.log?.(`${id}: the backend page did not load`, err);
      this.wentAway(id, win, "the page did not load");
    });
  }

  /** Only the current window of a plugin reports: one closed by the app (stop, reload, restart) says nothing. */
  private wentAway(id: string, win: ElectronWindow, reason: string): void {
    if (this.windows.get(id) !== win) return;
    this.live.get(id)?.gone(reason);
  }

  private closeWindow(id: string): void {
    const win = this.windows.get(id);
    if (!win) return;
    this.windows.delete(id);
    for (const [wcId, owner] of this.senders) {
      if (owner !== id) continue;
      this.senders.delete(wcId);
      this.inFlight.delete(wcId);
    }
    if (!win.isDestroyed()) win.destroy();
  }

  /** Registered at the first start (D0): Electron routes every window's invoke here, the app's page included (S9). */
  private registerChannel(): void {
    if (this.channelRegistered) return;
    this.channelRegistered = true;
    this.d.electron.ipcMain.handle("hh-plugin:rpc", (event, method: unknown, payload: unknown) => this.rpc(event, method, payload));
  }

  /**
   * One call from a page (B5, B11): the sender first (a registered window's main frame at its own host page; spike
   * S9), then the window's in-flight cap, and only then is the payload parsed. Nothing in it is read before that.
   */
  private async rpc(event: IpcMainInvokeEvent, method: unknown, payload: unknown): Promise<unknown> {
    const wcId = event.sender.id;
    const frame = event.senderFrame;
    const id = pluginOfSender({ webContentsId: wcId, frame: frame ? { url: frame.url, isMain: frame === event.sender.mainFrame } : null }, this.senders);
    const live = id === null ? undefined : this.live.get(id);
    if (id === null || !live) throw new Error("Unexpected sender");
    const n = this.inFlight.get(wcId) ?? 0;
    if (n >= HOST_IN_FLIGHT) throw new Error("Too many calls at once");
    this.inFlight.set(wcId, n + 1);
    try {
      const rpc = parsePluginRpc(method, payload);
      if (rpc === null) throw new Error("Unknown or malformed rpc");
      return await live.channel.dispatch(rpc);
    } finally {
      // A window closed meanwhile has no count left to lower.
      const now = this.inFlight.get(wcId);
      if (now !== undefined && this.senders.has(wcId)) this.inFlight.set(wcId, Math.max(0, now - 1));
    }
  }
}
