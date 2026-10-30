/**
 * The core broker's argument rules (tools spec §4.2; plugins threat model B6, B11), shared by every caller of the
 * broker (plugins, and tools from slice 2): every value a sandboxed caller sends is checked here before any dependency
 * sees it. Pure: no Electron, no file system. A failed check throws `Malformed`, whose message names the problem,
 * never the values.
 */
import type { FetchRequest } from "../plugin-fetch";

export const BROKER_LIMITS = {
  inFlight: 16,
  concurrent: 4,
  logChars: 2000,
  titleChars: 120,
  bodyChars: 500,
  chipChars: 40,
  focusChars: 200,
  varsBytes: 4096,
  keyChars: 200,
  records: 2000,
  depth: 32,
  /** Per call, over all its arguments: values reached (a shared reference counts each time) and text characters. */
  nodes: 200_000,
  chars: 10 * 1024 * 1024,
  queryLimit: 1000,
} as const;

/** C0 controls, DEL, C1 controls and the bidirectional overrides: never in a plugin's visible text. */
export const CONTROLS = /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;
export const CONTROLS_BUT_NEWLINE = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f‪-‮⁦-⁩]/g;

/** A refusal for a malformed call; the message names the problem, never the values. */
export class Malformed extends Error {}
export const fail = (message: string): never => {
  throw new Malformed(message);
};

export const isPlainObject = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

/**
 * One budget for a whole call, checked before anything else looks at it. Structured clone (Electron IPC) keeps shared
 * references and cycles, so a small message can unfold into a huge walk: every value reached counts, each time it is
 * reached, and so does every string's and key's length. Only arrays and plain objects are walked (the shape checks
 * refuse anything else); the walk stops at the first value over the budget, so it is bounded whatever arrives.
 */
export function checkBudget(args: unknown[]): void {
  const stack: unknown[] = [...args];
  let nodes = 0;
  let chars = 0;
  const over = () => fail("The call is too large");
  while (stack.length > 0) {
    const v = stack.pop();
    if (++nodes > BROKER_LIMITS.nodes) over();
    if (typeof v === "string") {
      if ((chars += v.length) > BROKER_LIMITS.chars) over();
      continue;
    }
    if (Array.isArray(v)) {
      // Everything on the stack will be counted, so a list that can't fit is refused before it is pushed.
      if (nodes + stack.length + v.length > BROKER_LIMITS.nodes) over();
      for (const item of v) stack.push(item);
      continue;
    }
    if (!isPlainObject(v)) continue;
    const keys = Object.keys(v);
    if (nodes + stack.length + keys.length > BROKER_LIMITS.nodes) over();
    for (const k of keys) {
      if ((chars += k.length) > BROKER_LIMITS.chars) over();
      stack.push(v[k]);
    }
  }
}

/**
 * Plain JSON data, bounded: null, booleans, finite numbers, strings, arrays and plain objects (undefined as a missing
 * value), at most BROKER_LIMITS.depth deep and .nodes values, no `__proto__` key. Iterative, so depth can't overflow.
 */
export function checkJson(value: unknown, what: string): void {
  const stack: [unknown, number][] = [[value, 0]];
  let nodes = 0;
  while (stack.length > 0) {
    const [v, depth] = stack.pop()!;
    if (++nodes > BROKER_LIMITS.nodes) fail(`${what} is too large`);
    if (v === null || v === undefined || typeof v === "boolean" || typeof v === "string") continue;
    if (typeof v === "number") {
      if (!Number.isFinite(v)) fail(`${what} holds a number that is not finite`);
      continue;
    }
    if (depth >= BROKER_LIMITS.depth) fail(`${what} is nested too deep`);
    if (Array.isArray(v)) {
      for (const item of v) stack.push([item, depth + 1]);
      continue;
    }
    if (!isPlainObject(v)) fail(`${what} is not plain JSON data`);
    for (const [k, item] of Object.entries(v as Record<string, unknown>)) {
      if (k === "__proto__") fail(`${what} has a key that is not allowed`);
      stack.push([item, depth + 1]);
    }
  }
}

export function record(v: unknown, what = "A record"): Record<string, unknown> {
  if (!isPlainObject(v)) fail(`${what} is an object`);
  checkJson(v, what);
  return v as Record<string, unknown>;
}

export function str(v: unknown, what: string, max: number): string {
  if (typeof v !== "string" || v.length > max) fail(`${what} is text of at most ${max} characters`);
  return v as string;
}

export function dataKey(v: unknown): string | number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.length <= BROKER_LIMITS.keyChars) return v;
  return fail("A key is text or a number");
}

/** Visible text: controls removed (newlines kept only where asked), trimmed, within `max` and not empty unless allowed. */
export function visible(v: unknown, what: string, max: number, o: { newlines?: boolean; optional?: boolean } = {}): string {
  if (typeof v !== "string" || v.length > max * 4) fail(`${what} is text`);
  const text = (v as string).replace(o.newlines ? CONTROLS_BUT_NEWLINE : CONTROLS, "").trim();
  if (text.length > max) fail(`${what} is at most ${max} characters`);
  if (text === "" && !o.optional) fail(`${what} is empty`);
  return text;
}

export function onlyKeys(v: Record<string, unknown>, keys: readonly string[], what: string): void {
  for (const k of Object.keys(v)) if (!keys.includes(k)) fail(`${what} has an unknown field`);
}

/** A counting semaphore: at most `n` holders, the rest wait in order. */
export class Slots {
  private free: number;
  private readonly waiting: (() => void)[] = [];
  constructor(n: number) {
    this.free = n;
  }
  async acquire(): Promise<() => void> {
    if (this.free > 0) this.free -= 1;
    else await new Promise<void>((r) => this.waiting.push(r));
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.free += 1;
    };
  }
}

export function withKey<T extends object>(op: T, key: string | number | undefined): T & { key?: string | number } {
  return key === undefined ? op : { ...op, key };
}

export function query(v: unknown): { where?: Record<string, unknown>; fields?: string[]; limit?: number } {
  if (v === undefined || v === null) return {};
  if (!isPlainObject(v)) fail("A query is an object");
  const q = v as Record<string, unknown>;
  onlyKeys(q, ["where", "fields", "limit"], "A query");
  const out: { where?: Record<string, unknown>; fields?: string[]; limit?: number } = {};
  if (q.where !== undefined) out.where = record(q.where, "A query's where");
  if (q.fields !== undefined) {
    if (!Array.isArray(q.fields) || q.fields.length > 100 || !q.fields.every((f) => typeof f === "string" && f.length <= 100)) fail("A query's fields are a list of names");
    out.fields = [...(q.fields as string[])];
  }
  if (q.limit !== undefined) {
    if (typeof q.limit !== "number" || !Number.isFinite(q.limit)) fail("A query's limit is a number");
    out.limit = Math.min(Math.max(Math.trunc(q.limit as number), 1), BROKER_LIMITS.queryLimit);
  }
  return out;
}

export function records(v: unknown): Record<string, unknown>[] {
  if (!Array.isArray(v) || v.length > BROKER_LIMITS.records) fail(`Records are a list of at most ${BROKER_LIMITS.records}`);
  return (v as unknown[]).map((r) => record(r));
}

export function fetchRequest(url: unknown, init: unknown): FetchRequest {
  const u = str(url, "A URL", 8192);
  if (init === undefined || init === null) return { url: u };
  if (!isPlainObject(init)) fail("fetch's options are an object");
  const i = init as Record<string, unknown>;
  onlyKeys(i, ["method", "headers", "body"], "fetch's options");
  const out: NonNullable<FetchRequest["init"]> = {};
  if (i.method !== undefined) out.method = str(i.method, "A method", 16);
  if (i.body !== undefined) out.body = str(i.body, "A body", 1024 * 1024);
  if (i.headers !== undefined) {
    if (!isPlainObject(i.headers)) fail("Headers are an object of text");
    const entries = Object.entries(i.headers as Record<string, unknown>);
    if (entries.length > 50 || !entries.every(([k, val]) => k.length <= 256 && typeof val === "string" && val.length <= 8192)) fail("Headers are at most 50 names with text values");
    // fromEntries: a header named __proto__ stays a plain property.
    out.headers = Object.fromEntries(entries as [string, string][]);
  }
  return { url: u, init: out };
}

/** One log line: controls become spaces. Not cut: the log dep hides keys first (see BrokerDeps.log). */
export function oneLine(v: unknown): string {
  if (typeof v !== "string") fail("A log message is text");
  return (v as string).replace(CONTROLS, " ").replace(/ {2,}/g, " ").trim();
}
