import { BACKEND_EVENT_MAX, BACKEND_LINE_MAX, BACKEND_NAME } from "@humanharness/harness-sdk";

/**
 * The harness backend's wire (hatches spec §4.2; threat model B3, B4, B5): newline-delimited JSON-RPC 2.0 on the
 * child's stdin/stdout. Pure: `backend-process.ts` plugs these into the child. Everything read here comes from the
 * backend and is checked as untrusted: parsed with `JSON.parse` only, sizes capped, names matched against the fixed
 * name regex. The backend can only answer our calls and send notifications; anything it asks is refused.
 */

/** What one line from the backend is. */
export type Incoming =
  | { kind: "response"; id: number; result?: unknown; error?: string }
  | { kind: "event"; event: string; data: unknown }
  | { kind: "request"; id: string | number; method: string }
  | { kind: "invalid"; why: string };

/** The answer to any request from a backend: the app has no method a backend may call (B4). */
export const REFUSAL_MESSAGE = "The app takes no requests from a backend";
/** A call's rejection message is cut to this many characters. */
const ERROR_MESSAGE_MAX = 500;
/** A request id longer than this is not echoed back. */
const REQUEST_ID_MAX = 200;
/** A refused request's method is logged cut to this many characters. */
const LOGGED_METHOD_MAX = 200;

/** True when `name` is a method or event name the protocol allows. */
export const isBackendName = (name: unknown): name is string => typeof name === "string" && BACKEND_NAME.test(name);

/**
 * Splits a byte stream into lines. A line longer than `BACKEND_LINE_MAX` bytes is discarded up to its newline and
 * reported once through `onDrop` with its size; the reader goes on with the next line. Lines are decoded as UTF-8
 * only once whole, so a character split across chunks survives. Blank lines are skipped; a trailing CR is cut.
 */
export class LineReader {
  private parts: Buffer[] = [];
  private size = 0;
  /** Bytes of the line being discarded, or null when not discarding. */
  private discarding: number | null = null;

  constructor(
    private readonly onLine: (line: string) => void,
    private readonly onDrop: (bytes: number) => void,
    private readonly max = BACKEND_LINE_MAX,
  ) {}

  push(chunk: Buffer): void {
    let start = 0;
    for (;;) {
      const nl = chunk.indexOf(0x0a, start);
      if (nl === -1) {
        this.keep(chunk.subarray(start));
        return;
      }
      this.keep(chunk.subarray(start, nl));
      this.end();
      start = nl + 1;
    }
  }

  private keep(part: Buffer): void {
    if (part.length === 0) return;
    if (this.discarding !== null) {
      this.discarding += part.length;
      return;
    }
    if (this.size + part.length > this.max) {
      this.discarding = this.size + part.length;
      this.parts = [];
      this.size = 0;
      return;
    }
    this.parts.push(part);
    this.size += part.length;
  }

  private end(): void {
    if (this.discarding !== null) {
      const bytes = this.discarding;
      this.discarding = null;
      this.onDrop(bytes);
      return;
    }
    let line = Buffer.concat(this.parts, this.size).toString("utf8");
    this.parts = [];
    this.size = 0;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    if (line.trim() !== "") this.onLine(line);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const has = (o: Record<string, unknown>, key: string): boolean => Object.hasOwn(o, key);

/** The message a rejected call carries: the backend's `error.message`, cut to 500 characters. */
const errorMessage = (error: unknown): string => {
  const message = isRecord(error) && typeof error.message === "string" ? error.message : "";
  return message === "" ? "The backend answered with an error" : message.slice(0, ERROR_MESSAGE_MAX);
};

/**
 * What a line from the backend is (B3): a response to one of `ours` (the ids of our calls in flight), a notification
 * with a valid name and params of at most `BACKEND_EVENT_MAX` bytes (an event), a request (to be refused with
 * `refusalFor`), or invalid (dropped and logged), which includes a response to an id we never sent.
 */
export function classifyIncoming(line: string, ours: ReadonlySet<number>): Incoming {
  let msg: unknown;
  try {
    msg = JSON.parse(line);
  } catch {
    return { kind: "invalid", why: "not JSON" };
  }
  if (!isRecord(msg)) return { kind: "invalid", why: "not a JSON object" };
  if (msg.jsonrpc !== "2.0") return { kind: "invalid", why: "not JSON-RPC 2.0" };

  const hasId = has(msg, "id") && msg.id !== null;
  if (has(msg, "method")) {
    const method = msg.method;
    if (typeof method !== "string") return { kind: "invalid", why: "a method that isn't a string" };
    if (hasId) {
      const id = msg.id;
      const echoable = (typeof id === "string" && id.length <= REQUEST_ID_MAX) || Number.isInteger(id);
      if (!echoable) return { kind: "invalid", why: "a request with an id that can't be answered" };
      return { kind: "request", id: id as string | number, method: method.slice(0, LOGGED_METHOD_MAX) };
    }
    if (!isBackendName(method)) return { kind: "invalid", why: "an event with an invalid name" };
    const data = has(msg, "params") ? (msg.params ?? null) : null;
    if (Buffer.byteLength(JSON.stringify(data)) > BACKEND_EVENT_MAX) {
      return { kind: "invalid", why: `the event "${method}" is over 64 KB` };
    }
    return { kind: "event", event: method, data };
  }

  if (hasId && (has(msg, "result") || has(msg, "error"))) {
    const id = msg.id;
    if (typeof id !== "number" || !Number.isInteger(id) || !ours.has(id)) {
      return { kind: "invalid", why: "a response to a call the app didn't make" };
    }
    if (has(msg, "error")) return { kind: "response", id, error: errorMessage(msg.error) };
    return { kind: "response", id, result: msg.result };
  }
  return { kind: "invalid", why: "neither a response nor a notification" };
}

/** One JSON-RPC 2.0 message as a line: a call (with `id`) or a notification (without). */
export const encode = (msg: { id?: number; method: string; params?: unknown }): string =>
  `${JSON.stringify({
    jsonrpc: "2.0",
    ...(msg.id === undefined ? {} : { id: msg.id }),
    method: msg.method,
    ...(msg.params === undefined ? {} : { params: msg.params }),
  })}\n`;

/** The line that answers a backend's request: method not found, as the app takes none (B4). */
export const refusalFor = (id: string | number): string =>
  `${JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32601, message: REFUSAL_MESSAGE } })}\n`;

/**
 * At most `perSecond` events in any rolling second (B5). `take()` says whether one more event goes through; the ones
 * that don't are counted until `flushDropped()`, which the caller logs once per second.
 */
export class EventLimiter {
  private readonly times: number[] = [];
  private head = 0;
  private dropped = 0;

  constructor(
    private readonly perSecond: number,
    private readonly now: () => number = Date.now,
  ) {}

  take(): boolean {
    const t = this.now();
    while (this.head < this.times.length && this.times[this.head] <= t - 1000) this.head++;
    if (this.head > 1024) {
      this.times.splice(0, this.head);
      this.head = 0;
    }
    if (this.times.length - this.head < this.perSecond) {
      this.times.push(t);
      return true;
    }
    this.dropped++;
    return false;
  }

  /** The events dropped since the last flush; resets the count. */
  flushDropped(): number {
    const n = this.dropped;
    this.dropped = 0;
    return n;
  }
}
