/**
 * The panel side of the panel protocol (plugins plan part 2, Decision 7). A panel runs in a sandboxed iframe with an
 * opaque origin; it talks to the app window only through `postMessage`. Calls are `{ hh: 1, id, call, args }`, answers
 * `{ hh: 1, re, ok, value | error }`, events `{ hh: 1, event, … }`. The app's origin reads "null" from here (a `file:`
 * page), so a message counts only when its `source` is this window's parent, never by origin (spike P-S5).
 */

export const CALL_TIMEOUT_MS = 15_000;
/** The app's frame ignores anything larger (Decision 7), so a call that big fails here at once. */
export const MESSAGE_MAX_CHARS = 64 * 1024;

export type PanelEvent =
  | { event: "data"; collections: string[] }
  | { event: "theme"; dark: boolean }
  | { event: "focus"; focus: string | null };

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: ReturnType<typeof setTimeout> };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One event from the app, checked field by field; anything else is null. */
function readEvent(d: Record<string, unknown>): PanelEvent | null {
  switch (d.event) {
    case "data":
      return Array.isArray(d.collections) && d.collections.every((c) => typeof c === "string") ? { event: "data", collections: d.collections } : null;
    case "theme":
      return typeof d.dark === "boolean" ? { event: "theme", dark: d.dark } : null;
    case "focus":
      return typeof d.focus === "string" || d.focus === null ? { event: "focus", focus: d.focus } : null;
    default:
      return null;
  }
}

export class PanelBridge {
  private next = 1;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Set<(e: PanelEvent) => void>();
  /** The last `focus` the app sent, kept so a component mounted later still sees it. */
  focus: string | null = null;
  /** The app's theme once it said so; until then, null (the system's, through tokens.css). */
  dark: boolean | null = null;

  constructor(private readonly win: Window = window) {
    win.addEventListener("message", this.onMessage);
  }

  /** A call answered by the app: resolves with `value`, rejects with `error` or after 15 s. */
  call(call: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.next++;
    const msg = { hh: 1, id, call, args };
    let size: number;
    try {
      size = JSON.stringify(msg).length;
    } catch {
      return Promise.reject(new Error("The call can't be sent"));
    }
    if (size > MESSAGE_MAX_CHARS) return Promise.reject(new Error("Too large"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("The app didn't answer"));
      }, CALL_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      this.win.parent.postMessage(msg, "*");
    });
  }

  /** A call nobody answers (`resize`): posted, never waited for. */
  send(call: string, args: Record<string, unknown> = {}): void {
    this.win.parent.postMessage({ hh: 1, id: this.next++, call, args }, "*");
  }

  /** Listens to the app's events; returns the unsubscribe. */
  on(listener: (e: PanelEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Stops listening; every call still waiting rejects at once, rather than hanging until its timeout. */
  dispose(): void {
    this.win.removeEventListener("message", this.onMessage);
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Closed"));
    }
    this.pending.clear();
    this.listeners.clear();
  }

  private readonly onMessage = (e: MessageEvent): void => {
    // Only the app window that holds this frame speaks to it (P4's mirror): never another frame or a window it opened.
    if (e.source !== this.win.parent || e.source === this.win) return;
    const d: unknown = e.data;
    if (!isRecord(d) || d.hh !== 1) return;
    if (typeof d.re === "number") {
      const p = this.pending.get(d.re);
      if (!p) return;
      this.pending.delete(d.re);
      clearTimeout(p.timer);
      if (d.ok === true) p.resolve(d.value);
      else p.reject(new Error(typeof d.error === "string" ? d.error : "The call failed"));
      return;
    }
    const ev = readEvent(d);
    if (!ev) return;
    if (ev.event === "focus") this.focus = ev.focus;
    if (ev.event === "theme") this.dark = ev.dark;
    for (const l of [...this.listeners]) l(ev);
  };
}

let shared: PanelBridge | null = null;
/** The panel's one bridge, made on first use. */
export function panelBridge(): PanelBridge {
  shared ??= new PanelBridge(window);
  return shared;
}
