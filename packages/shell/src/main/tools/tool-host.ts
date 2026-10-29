import { existsSync } from "node:fs";
import path from "node:path";
import type { BrowserWindow as ElectronWindow, IpcMainInvokeEvent, Session } from "electron";
import type { BrokerAnswer } from "../broker/broker";
import { TOOL_CSP, type ToolRpc, allowToolRequest, parseToolRpc, readToolFile, toolHostUrl, toolOfSender } from "./tool-protocol";

/**
 * The tool host (tools spec §4.1, D2, D3; threat rows T1, T2, T6): one hidden, sandboxed Chromium window per harness
 * that runs its built tools, in an in-memory session of its own, served only by the `hh-tools:` scheme. The only
 * module that touches Electron for tools: what it decides is in tool-protocol.ts (pure); this file plugs it in, and
 * keeps the calls: each one goes to the page under a call id main made, so the tool a `ctx` call acts for is the call
 * id's, never the page's word. It copies the plugin backend host's settings, but is a class, scheme, session and
 * channel of its own.
 *
 * The host stays warm (Decision 7). A crash fails the calls the dead page held and restarts it after 1 s, 2 s, 4 s …
 * at most 30 s; the 5th crash within an hour turns tools off until the app restarts.
 *
 * D0: nothing happens until `start`, which only a harness with tools calls: no partition, no scheme handler, no
 * listener, no IPC handler, no window.
 */

/** The tool host's one channel (Decision 15): answers only the host window's main frame at its own host page. */
export const TOOL_RPC_CHANNEL = "hh-tools:rpc";

/** The most tool calls waiting or running at once (T6). */
export const TOOL_CALLS_IN_FLIGHT = 32;

/**
 * The most `rpc` calls the window may have unanswered (T6), counted before a payload is parsed: room for every call
 * in flight to wait on a `ctx` call, plus `next`, `done` and `ready`. Beyond it a call is refused unread.
 */
export const TOOL_RPC_IN_FLIGHT = 64;

/** How long a `next` waits for a call before it answers idle (and the page asks again). */
export const TOOL_IDLE_MS = 25_000;

/** Restart backoff and the cut-off (Decision 7). */
export const TOOL_CRASHES = { max: 5, windowMs: 60 * 60_000, firstDelayMs: 1_000, maxDelayMs: 30_000 } as const;

export const TOOLS_OFF = "Tools are off after repeated crashes";

/** The host's page, script and preload, in `resources`. Without one the window would never say ready. */
export const TOOL_HOST_FILES = ["tool-host.html", "tool-host.mjs", "tool-preload.cjs"] as const;
/** What `start` throws when one of them is missing: tools are off, never a silent timeout per call. */
export const TOOL_HOST_FILES_MISSING = "the tool host's files are missing";
export const TOOLS_BUSY = "Too many tool calls at once";
const STOPPED = "Tools stopped";
const ENDED = "Unknown tool call";

/** A refusal as an answer, never a throw (a throw in `ipcMain.handle` makes Electron print a stack per call). */
const rpcRefusal = (reason: string) => ({ ok: false, refused: reason }) as const;

const HEADERS = { "content-security-policy": TOOL_CSP, "x-content-type-options": "nosniff", "cache-control": "no-store" } as const;

export interface ToolHostCall {
  /** Made by main (the tool broker's run id): the only id a `ctx` call may name. */
  callId: string;
  tool: string;
  /** Already checked against the tool's params by the registry. */
  args: unknown;
  scope: string | null;
}

export type ToolHostAnswer = { ok: true; value: unknown; summary?: string } | { ok: false; error: string };

/** Where the page's `ctx` calls go: the broker of `tool`, the tool main gave call `callId` to. */
export interface ToolChannel {
  ctx(tool: string, callId: string, name: string, args: unknown[]): Promise<BrokerAnswer>;
}

export interface ToolHostDeps {
  /** The shell's resources folder (shell-resources.ts): the preload and the core host page and script. */
  resources: string;
  /** Development builds only. */
  devTools: boolean;
  electron: Pick<typeof import("electron"), "BrowserWindow" | "session" | "ipcMain">;
  log?(message: string, err?: unknown): void;
  now?(): number;
}

type Command = { kind: "call"; callId: string; tool: string; args: unknown; scope: string | null } | { kind: "idle" };

interface Pending {
  call: ToolHostCall;
  /** Handed to the current page. */
  running: boolean;
  timer: ReturnType<typeof setTimeout>;
  settle(answer: ToolHostAnswer): void;
}

interface Started {
  harnessId: string;
  dist: string;
  ids: readonly string[];
  channel: ToolChannel;
  onCrash?(reason: string): void;
  onOff?(reason: string): void;
}

export class ToolHost {
  private s: Started | null = null;
  private win: ElectronWindow | null = null;
  /** The current window's webContents id → its harness and host page, for the sender check. */
  private readonly senders = new Map<number, { harness: string; tools: readonly string[] }>();
  private readonly inFlight = new Map<number, number>();
  private readonly sessions = new Set<string>();
  private channelRegistered = false;
  private readonly calls = new Map<string, Pending>();
  private readonly queue: string[] = [];
  private readonly waiting: ((c: Command) => void)[] = [];
  /** The current page's load: null until its `ready`. */
  private loaded: { tools: Set<string>; errors: Map<string, string> } | null = null;
  private crashes: number[] = [];
  private streak = 0;
  private lastCrash = Number.NEGATIVE_INFINITY;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private offReason: string | null = null;

  constructor(private readonly d: ToolHostDeps) {}

  /** Opens the host window for `harnessId`'s built tools `ids` (the ones tools.json names). */
  start(p: Started): void {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(p.harnessId)) throw new Error("Not a harness id the tool host can serve");
    const missing = TOOL_HOST_FILES.map((f) => path.join(this.d.resources, f)).filter((f) => !existsSync(f));
    if (missing.length > 0) {
      this.d.log?.(`${p.harnessId}: ${TOOL_HOST_FILES_MISSING}: ${missing.join(", ")}`);
      throw new Error(TOOL_HOST_FILES_MISSING);
    }
    this.stop();
    this.s = { ...p, ids: [...p.ids] };
    this.offReason = null;
    this.crashes = [];
    this.streak = 0;
    this.lastCrash = Number.NEGATIVE_INFINITY;
    this.registerChannel();
    this.openWindow();
  }

  /** Why every call fails until the app restarts, or null. */
  off(): string | null {
    return this.offReason;
  }

  /** Runs one call in the page; settles with its answer, a timeout after `timeoutMs`, or the host's failure. */
  call(c: ToolHostCall, timeoutMs: number): Promise<ToolHostAnswer> {
    if (this.offReason !== null) return Promise.resolve({ ok: false, error: this.offReason });
    const s = this.s;
    if (!s) return Promise.resolve({ ok: false, error: STOPPED });
    if (!s.ids.includes(c.tool)) return Promise.resolve({ ok: false, error: `No tool "${c.tool.slice(0, 64)}" is built` });
    const loadError = this.loaded?.errors.get(c.tool);
    if (loadError !== undefined) return Promise.resolve({ ok: false, error: `${c.tool} did not load: ${loadError}` });
    if (this.calls.has(c.callId)) return Promise.resolve({ ok: false, error: "That tool call is already running" });
    if (this.calls.size >= TOOL_CALLS_IN_FLIGHT) return Promise.resolve({ ok: false, error: TOOLS_BUSY });
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.finish(c.callId, { ok: false, error: `${c.tool} took longer than ${timeoutMs / 1000} s` }), timeoutMs);
      this.calls.set(c.callId, { call: c, running: false, timer, settle: resolve });
      this.queue.push(c.callId);
      this.pump();
    });
  }

  /** Closes the window; every pending call fails; nothing is answered or restarted after. */
  stop(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.closeWindow();
    for (const id of [...this.calls.keys()]) this.finish(id, { ok: false, error: STOPPED });
    this.s = null;
  }

  /** The harness's in-memory session (no `persist:`), set up once: its scheme, its request filter, no permissions. */
  private sessionOf(id: string): Session {
    const ses = this.d.electron.session.fromPartition(`hh-tools-${id}`);
    if (this.sessions.has(id)) return ses;
    this.sessions.add(id);
    ses.protocol.handle("hh-tools", (req) => this.serve(id, req));
    // T1: every request that isn't one of this harness's own hh-tools: files is cancelled.
    ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => callback({ cancel: !allowToolRequest(details.url, id) }));
    ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler(() => false);
    ses.setDevicePermissionHandler(() => false);
    ses.on("will-download", (event) => event.preventDefault());
    return ses;
  }

  /** One hh-tools: response; every one, a refusal included, carries the CSP and nosniff. */
  private async serve(id: string, req: Request): Promise<Response> {
    const notFound = () => new Response(null, { status: 404, headers: HEADERS });
    try {
      const s = this.s;
      if (!s || s.harnessId !== id || req.method !== "GET") return notFound();
      const read = await readToolFile(req.url, { id, dist: s.dist, core: this.d.resources });
      if (!read) return notFound();
      return new Response(new Uint8Array(read.body), { headers: { ...HEADERS, "content-type": read.type } });
    } catch (err) {
      this.d.log?.(`${id}: a tool file could not be served`, err);
      return notFound();
    }
  }

  private openWindow(): void {
    const s = this.s!;
    const win = new this.d.electron.BrowserWindow({
      show: false,
      width: 320,
      height: 240,
      skipTaskbar: true,
      webPreferences: {
        session: this.sessionOf(s.harnessId),
        preload: path.join(this.d.resources, "tool-preload.cjs"),
        // T1: no Node, no Electron, nothing but the preload's hh.rpc.
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
    this.win = win;
    this.loaded = null;
    this.senders.set(wc.id, { harness: s.harnessId, tools: s.ids });
    // The page never leaves its host page, opens nothing and downloads nothing. A load main starts fires none of these.
    wc.setWindowOpenHandler(() => ({ action: "deny" }));
    wc.on("will-navigate", (event) => event.preventDefault());
    wc.on("will-frame-navigate", (event) => event.preventDefault());
    wc.on("will-redirect", (event) => event.preventDefault());
    wc.on("will-attach-webview", (event) => event.preventDefault());
    wc.on("render-process-gone", (_event, details) => this.wentAway(win, details.reason));
    // A tool stuck in a loop: its call times out on its own; the page is replaced like a crash.
    wc.on("unresponsive", () => this.wentAway(win, "unresponsive"));
    wc.loadURL(toolHostUrl(s.harnessId, s.ids)).catch((err: unknown) => {
      this.d.log?.(`${s.harnessId}: the tool host page did not load`, err);
      this.wentAway(win, "the page did not load");
    });
  }

  private closeWindow(): void {
    const win = this.win;
    this.win = null;
    this.loaded = null;
    this.senders.clear();
    this.inFlight.clear();
    for (const w of this.waiting.splice(0)) w({ kind: "idle" });
    if (win && !win.isDestroyed()) win.destroy();
  }

  /**
   * The current window crashed, hung or failed to load (a window main closed says nothing): the calls its page held
   * fail, queued ones wait for the next page. The 5th crash within an hour turns tools off; otherwise a restart
   * after the backoff, which doubles while crashes come within an hour of each other.
   */
  private wentAway(win: ElectronWindow, reason: string): void {
    if (this.win !== win || !this.s) return;
    const s = this.s;
    this.closeWindow();
    for (const [id, p] of [...this.calls]) if (p.running) this.finish(id, { ok: false, error: `The tools host stopped (${reason})` });
    this.d.log?.(`${s.harnessId}: the tool host went away (${reason})`);
    s.onCrash?.(reason);
    const now = (this.d.now ?? Date.now)();
    this.crashes = [...this.crashes.filter((t) => now - t < TOOL_CRASHES.windowMs), now];
    this.streak = now - this.lastCrash < TOOL_CRASHES.windowMs ? this.streak + 1 : 1;
    this.lastCrash = now;
    if (this.crashes.length >= TOOL_CRASHES.max) {
      this.offReason = TOOLS_OFF;
      for (const id of [...this.calls.keys()]) this.finish(id, { ok: false, error: TOOLS_OFF });
      this.d.log?.(`${s.harnessId}: ${TOOLS_OFF}`);
      s.onOff?.(TOOLS_OFF);
      return;
    }
    const delay = Math.min(TOOL_CRASHES.maxDelayMs, TOOL_CRASHES.firstDelayMs * 2 ** (this.streak - 1));
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      if (this.s === s && this.offReason === null) this.openWindow();
    }, delay);
  }

  /** Settles call `id` once: its timer cleared, out of the queue; a later `done` or `ctx` for it finds nothing. */
  private finish(id: string, answer: ToolHostAnswer): void {
    const p = this.calls.get(id);
    if (!p) return;
    this.calls.delete(id);
    clearTimeout(p.timer);
    const i = this.queue.indexOf(id);
    if (i >= 0) this.queue.splice(i, 1);
    p.settle(answer);
  }

  /** Hands queued calls to a waiting `next` of a page that loaded its tools. */
  private pump(): void {
    while (this.loaded && this.waiting.length > 0 && this.queue.length > 0) {
      const id = this.queue.shift()!;
      const p = this.calls.get(id);
      if (!p) continue;
      const loadError = this.loaded.errors.get(p.call.tool);
      if (loadError !== undefined || !this.loaded.tools.has(p.call.tool)) {
        this.finish(id, { ok: false, error: `${p.call.tool} did not load: ${loadError ?? "the page did not report it"}` });
        continue;
      }
      p.running = true;
      this.waiting.shift()!({ kind: "call", callId: id, tool: p.call.tool, args: p.call.args, scope: p.call.scope });
    }
  }

  /** Registered at the first start (D0): Electron routes every window's invoke here, the app's page included. */
  private registerChannel(): void {
    if (this.channelRegistered) return;
    this.channelRegistered = true;
    this.d.electron.ipcMain.handle("hh-tools:rpc", (event, method: unknown, payload: unknown) => this.rpc(event, method, payload));
  }

  /**
   * One call from a page (T2, T6): the sender first (the host window's main frame at its own host page), then the
   * window's in-flight cap, and only then is the payload parsed. Every refusal is an answer, never a throw.
   */
  private async rpc(event: IpcMainInvokeEvent, method: unknown, payload: unknown): Promise<unknown> {
    const wcId = event.sender.id;
    const frame = event.senderFrame;
    const harness = toolOfSender({ webContentsId: wcId, frame: frame ? { url: frame.url, isMain: frame === event.sender.mainFrame } : null }, this.senders);
    if (harness === null || !this.s) return rpcRefusal("Unexpected sender");
    const n = this.inFlight.get(wcId) ?? 0;
    if (n >= TOOL_RPC_IN_FLIGHT) return rpcRefusal("Too many calls at once");
    this.inFlight.set(wcId, n + 1);
    try {
      const rpc = parseToolRpc(method, payload);
      if (rpc === null) return rpcRefusal("Unknown or malformed rpc");
      return await this.dispatch(rpc);
    } catch (err) {
      return rpcRefusal(err instanceof Error ? err.message : "Refused");
    } finally {
      // A window closed meanwhile has no count left to lower.
      const now = this.inFlight.get(wcId);
      if (now !== undefined && this.senders.has(wcId)) this.inFlight.set(wcId, Math.max(0, now - 1));
    }
  }

  private async dispatch(rpc: ToolRpc): Promise<unknown> {
    const s = this.s!;
    switch (rpc.method) {
      case "ready": {
        if (this.loaded) return null;
        const errors = new Map(rpc.errors.filter((e) => s.ids.includes(e.tool)).map((e) => [e.tool, e.error] as const));
        this.loaded = { tools: new Set(rpc.tools.filter((t) => s.ids.includes(t) && !errors.has(t))), errors };
        for (const [tool, error] of errors) this.d.log?.(`${s.harnessId}: ${tool} did not load: ${error.slice(0, 500)}`);
        for (const [id, p] of [...this.calls]) {
          const e = errors.get(p.call.tool);
          if (e !== undefined) this.finish(id, { ok: false, error: `${p.call.tool} did not load: ${e}` });
        }
        this.pump();
        return null;
      }
      case "next":
        if (!this.loaded) return rpcRefusal("The tool host is not ready");
        return this.next();
      case "done": {
        const p = this.calls.get(rpc.callId);
        if (!p?.running) return null;
        if (rpc.ok) this.finish(rpc.callId, { ok: true, value: rpc.value, ...(rpc.summary !== undefined ? { summary: rpc.summary } : {}) });
        else this.finish(rpc.callId, { ok: false, error: rpc.error });
        return null;
      }
      case "ctx": {
        // T2: the tool is the one main handed this call id to, and only while it runs in this page.
        const p = this.calls.get(rpc.callId);
        if (!p?.running) return rpcRefusal(ENDED);
        return s.channel.ctx(p.call.tool, rpc.callId, rpc.name, rpc.args);
      }
    }
  }

  private next(): Promise<Command> {
    return new Promise((resolve) => {
      const waiter = (c: Command) => {
        clearTimeout(timer);
        resolve(c);
      };
      const timer = setTimeout(() => {
        const i = this.waiting.indexOf(waiter);
        if (i >= 0) this.waiting.splice(i, 1);
        resolve({ kind: "idle" });
      }, TOOL_IDLE_MS);
      this.waiting.push(waiter);
      this.pump();
    });
  }
}
