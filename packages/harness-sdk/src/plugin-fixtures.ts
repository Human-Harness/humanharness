// Node only (Buffer): the shell's main and the CLI import this as `@humanharness/harness-sdk/plugin-fixtures`; the
// SDK's main entry stays free of it, since screens and plugin bundles import that one.
import { Buffer } from "node:buffer";
import { z } from "zod";

const MAX_TEXT = 10 * 1024 * 1024;
const headers = z.record(z.string().max(200), z.string().max(8192));
/** One recorded exchange: `fixtures/<source>/<NNN>.json` (Decision 14). Hostile input, like all of a plugin's files. */
export const fixtureSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("fetch"),
    request: z.strictObject({ method: z.string().regex(/^[A-Z]{3,7}$/), url: z.string().max(4096), headers: headers.optional(), body: z.string().max(MAX_TEXT).optional() }),
    // 200–599: what a Response can carry; 1xx never reaches a fetch caller.
    response: z.strictObject({ status: z.number().int().min(200).max(599), headers, text: z.string().max(MAX_TEXT) }),
  }),
  z.strictObject({
    kind: z.literal("exec"),
    request: z.strictObject({ cmd: z.string().max(64), args: z.array(z.string().max(4096)).max(64) }),
    response: z.strictObject({ code: z.number().int(), stdout: z.string().max(MAX_TEXT), stderr: z.string().max(MAX_TEXT) }),
  }),
]);
export type FixtureExchange = z.infer<typeof fixtureSchema>;
export const parseFixture = (raw: unknown): FixtureExchange => fixtureSchema.parse(raw);

export type FixtureRequest = { kind: "fetch"; method: string; url: string } | { kind: "exec"; cmd: string; args: string[] };

const segmentsMatch = (want: string[], got: string[]) => want.length === got.length && want.every((w, i) => w === "*" || w === got[i]);

/** Does a recorded exchange answer this request (Decision 14)? `*` matches one path segment or one arg; no regex. */
export function matchFixture(f: FixtureExchange, r: FixtureRequest): boolean {
  if (f.kind === "exec") return r.kind === "exec" && f.request.cmd === r.cmd && segmentsMatch(f.request.args, r.args);
  if (r.kind !== "fetch" || f.request.method !== r.method) return false;
  const [fu, ru] = [splitUrl(f.request.url), splitUrl(r.url)];
  if (!fu || !ru || fu.origin !== ru.origin) return false;
  if (fu.query !== "?*" && fu.query !== ru.query) return false;
  return segmentsMatch(fu.path, ru.path);
}

/** Origin, path segments and raw query, without URL normalising `*` away. */
function splitUrl(raw: string): { origin: string; path: string[]; query: string } | null {
  const m = /^(https?:\/\/[^/?#]+)([^?#]*)(\?[^#]*)?/.exec(raw);
  if (!m) return null;
  return { origin: m[1].toLowerCase(), path: m[2].split("/").slice(1), query: m[3] ?? "" };
}

export interface FixtureExecResult {
  code: number;
  stdout: string;
  stderr: string;
}
/** Statuses a Response must have no body for. */
const NULL_BODY = new Set([204, 205, 304]);

/**
 * A transport that plays recorded exchanges and never touches the network or a process (P10). Each request takes the
 * first unused matching exchange; when all its matches are used, they start over (a TTL loop replays). Request
 * headers and bodies aren't compared. Shaped like `fetch` and the shell's `runFile`, so the broker takes it as is.
 */
export function fixtureTransport(exchanges: FixtureExchange[]): {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  run(file: string, args: string[], o: { cwd: string; env: Record<string, string>; timeoutMs?: number; maxBytes?: number; signal?: AbortSignal }): Promise<FixtureExecResult>;
} {
  const used = new Set<number>();
  const take = (r: FixtureRequest): FixtureExchange | null => {
    const hits = exchanges.flatMap((f, n) => (matchFixture(f, r) ? [n] : []));
    if (hits.length === 0) return null;
    let i = hits.find((n) => !used.has(n));
    if (i === undefined) {
      for (const n of hits) used.delete(n);
      i = hits[0];
    }
    used.add(i);
    return exchanges[i];
  };
  return {
    async fetch(input, init = {}) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const method = (init.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const f = take({ kind: "fetch", method, url });
      if (!f || f.kind !== "fetch") throw new Error(`No fixture for ${method} ${url}`);
      return new Response(NULL_BODY.has(f.response.status) ? null : f.response.text, { status: f.response.status, headers: f.response.headers });
    },
    async run(file, args) {
      const cmd = file.split(/[\\/]/).pop() ?? file;
      const f = take({ kind: "exec", cmd, args });
      if (!f || f.kind !== "exec") throw new Error(`No fixture for ${cmd} ${args.join(" ")}`);
      return { ...f.response };
    },
  };
}

const bytesOf = (s: string) => Buffer.from(s, "utf8");
/** The ways a key shows up in a request or a response: raw, URL-encoded (both hex cases, and as a form) and base64. */
function forms(s: string): string[] {
  const b64 = bytesOf(s).toString("base64");
  const url = encodeURIComponent(s);
  const all = [s, url, url.replace(/%[0-9A-F]{2}/g, (h) => h.toLowerCase()), new URLSearchParams([["k", s]]).toString().slice(2), b64, b64.replace(/=+$/, ""), bytesOf(s).toString("base64url")];
  return [...new Set(all)].filter((f) => f.length > 0).sort((a, b) => b.length - a.length);
}
/** Inside JSON text: what a string holding `s` looks like once stringified. */
const inJson = (s: string) => JSON.stringify(s).slice(1, -1);
const B64_TOKEN = /[A-Za-z0-9+/_-]{8,}={0,2}/g;

/** Every string of a value, object keys included. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === "string") out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (typeof v === "object" && v !== null)
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      strings(x, out);
    }
  return out;
}

/** `s` with %XX escapes (either case) and `+` decoded, leniently: a broken escape stays as it is. */
const percentDecoded = (s: string) => Buffer.from(s.replace(/\+/g, " ").replace(/%([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), "latin1");

/** Does `s` still hold `secret`, in any form we can decode (base64 at any offset, inside a longer token too)? */
function holds(s: string, secret: string): boolean {
  const raw = bytesOf(secret);
  if (s.includes(secret) || percentDecoded(s).includes(raw)) return true;
  for (const m of s.matchAll(B64_TOKEN))
    for (let shift = 0; shift < 4; shift++) if (Buffer.from(m[0].slice(shift), "base64").includes(raw)) return true;
  return false;
}

/**
 * Every key's raw, URL-encoded and base64 forms replaced by `{{secret:<id>}}` (P11). `leaked` lists the ids still found
 * in any form we can decode — base64 at an offset the substring pass can't see, say; the caller then writes nothing.
 */
export function stripSecrets(exchange: FixtureExchange, secrets: Record<string, string>): { exchange: FixtureExchange; leaked: string[] } {
  let text = JSON.stringify(exchange);
  const entries = Object.entries(secrets)
    .filter(([, v]) => v.length > 0)
    .sort((a, b) => b[1].length - a[1].length);
  for (const [id, value] of entries) for (const f of forms(value)) text = text.split(inJson(f)).join(`{{secret:${id}}}`);
  const out = parseFixture(JSON.parse(text));
  const all = strings(out);
  const leaked = entries.filter(([, v]) => all.some((s) => holds(s, v))).map(([id]) => id);
  return { exchange: out, leaked };
}
