import { fillSecrets, hostAllowed, redact } from "@humanharness/harness-sdk";

/**
 * The broker's `ctx.fetch` (plugins spec §4.2, Decision 8; threat model B2, B6). The plugin's request is hostile: it is
 * checked whole before any network, the URL never carries a key, keys are filled only into header values and the body,
 * every hop of a redirect is checked like the first, and whatever comes back (headers, text, the final URL, any error)
 * has every filled value redacted.
 */

export interface FetchRequest {
  url: string;
  init?: { method?: string; headers?: Record<string, string>; body?: string };
}
export interface FetchedResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text: string;
}
export type FetchOutcome = { ok: true; response: FetchedResponse } | { ok: false; reason: string };

export interface PluginFetchOptions {
  /** The approved `permissions.hosts`. */
  hosts: readonly string[];
  /** The values of the keys the request names, approved and stored; nothing else. */
  secrets: Readonly<Record<string, string>>;
  fetch: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
  /** The run's signal: the run ending aborts the request. */
  signal?: AbortSignal;
  /** An extra check of each hop's host name (the controller may refuse private addresses). */
  allowHost?: (hostname: string) => Promise<boolean>;
}

export const FETCH_LIMITS = {
  timeoutMs: 30_000,
  maxBytes: 10 * 1024 * 1024,
  maxRedirects: 5,
  urlChars: 8192,
  headers: 50,
  headerChars: 8192,
  bodyChars: 1024 * 1024,
} as const;

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const FORBIDDEN = new Set(["host", "content-length", "transfer-encoding", "connection", "upgrade", "proxy-authorization", "te", "trailer", "keep-alive"]);
const HEADER_NAME = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,256}$/;
/** A header value is one line of visible text and spaces, in bytes as Headers takes them (no controls, nothing past U+00FF). */
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
const SECRET_LIKE = /\{\{\s*secret/i;
const REDIRECTS = new Set([301, 302, 303, 307, 308]);
/** Headers that go with credentials or with a body: dropped when the host changes, or with the body. */
const CREDENTIAL_HEADERS = ["authorization", "cookie"];
const BODY_HEADERS = ["content-type", "content-encoding", "content-language", "content-location"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const size = (bytes: number) => (bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`);
const duration = (ms: number) => (ms >= 1000 ? `${Math.round(ms / 1000)} s` : `${ms} ms`);
const refuse = (reason: string): FetchOutcome => ({ ok: false, reason });

type Checked = { url: URL; method: string; headers: [string, string][]; body: string | undefined };

/** The request's shape and sizes, the URL and the method: everything that needs no key. */
function check(req: unknown, hosts: readonly string[]): Checked | string {
  if (!isRecord(req) || typeof req.url !== "string") return "fetch takes a URL";
  if (req.url.length > FETCH_LIMITS.urlChars) return `A URL is at most ${FETCH_LIMITS.urlChars} characters`;
  if (SECRET_LIKE.test(req.url)) return "A key can't go into the URL: put it in a header or the body";
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return "The URL is not valid";
  }
  if (url.protocol !== "https:") return "Only https URLs can be fetched";
  if (!hostAllowed(url.href, hosts)) return `${url.host} is not declared in permissions.hosts`;
  const init = req.init ?? {};
  if (!isRecord(init)) return "fetch's options are an object";
  const method = init.method === undefined ? "GET" : typeof init.method === "string" ? init.method.toUpperCase() : "";
  if (!METHODS.has(method)) return `The method ${String(init.method).slice(0, 20)} is not allowed`;
  const body = init.body;
  if (body !== undefined && typeof body !== "string") return "A body is text";
  if (body !== undefined && body.length > FETCH_LIMITS.bodyChars) return `A body is at most ${size(FETCH_LIMITS.bodyChars)}`;
  if (body !== undefined && (method === "GET" || method === "HEAD")) return `A ${method} request has no body`;
  const raw = init.headers ?? {};
  if (!isRecord(raw)) return "Headers are an object of text";
  const headers = Object.entries(raw);
  if (headers.length > FETCH_LIMITS.headers) return `At most ${FETCH_LIMITS.headers} headers`;
  for (const [name, value] of headers) {
    if (!HEADER_NAME.test(name)) return "A header name is not valid";
    if (FORBIDDEN.has(name.toLowerCase())) return `The header ${name} can't be set`;
    if (typeof value !== "string" || value.length > FETCH_LIMITS.headerChars || !HEADER_VALUE.test(value)) return `The header ${name} has a value that is not valid`;
  }
  return { url, method, headers: headers as [string, string][], body };
}

/** Reads the body up to `max` bytes; null past it. */
async function readCapped(res: Response, max: number): Promise<Uint8Array | null> {
  if (!res.body) return new Uint8Array();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.byteLength;
  }
  return out;
}

export async function pluginFetch(req: FetchRequest, o: PluginFetchOptions): Promise<FetchOutcome> {
  const timeoutMs = o.timeoutMs ?? FETCH_LIMITS.timeoutMs;
  const maxBytes = o.maxBytes ?? FETCH_LIMITS.maxBytes;
  const checked = check(req, o.hosts);
  if (typeof checked === "string") return refuse(checked);
  let { url, method, body } = checked;
  const values = [...new Set(Object.values(o.secrets))];
  const clean = (text: string) => redact(text, values);

  // Keys: filled into header values and the body only, in one pass each; which headers (and whether the body) held one.
  // A filled value is checked again, and Headers can't throw past here: its message would tell where a key's bad
  // character sits, so a bad value is one fixed refusal.
  const headers = new Headers();
  const secretHeaders = new Set<string>();
  for (const [name, value] of checked.headers) {
    const filled = fillSecrets(value, o.secrets);
    if (!filled.ok) return refuse(filled.reason);
    const invalid = `The header ${name} has a value that is not valid`;
    if (!HEADER_VALUE.test(filled.text)) return refuse(invalid);
    try {
      headers.append(name, filled.text);
    } catch {
      return refuse(invalid);
    }
    if (filled.used.length > 0) secretHeaders.add(name.toLowerCase());
  }
  let bodyHasSecret = false;
  if (body !== undefined) {
    const filled = fillSecrets(body, o.secrets);
    if (!filled.ok) return refuse(filled.reason);
    bodyHasSecret = filled.used.length > 0;
    body = filled.text;
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const signal = o.signal ? AbortSignal.any([controller.signal, o.signal]) : controller.signal;
  try {
    for (let hop = 0; ; hop++) {
      if (o.allowHost && !(await o.allowHost(url.hostname))) return refuse(clean(`${url.hostname} resolves to a private address`));
      if (signal.aborted) throw new Error("aborted");
      const res = await o.fetch(url.href, { method, headers: new Headers(headers), ...(body !== undefined ? { body } : {}), redirect: "manual", signal });
      const location = REDIRECTS.has(res.status) ? res.headers.get("location") : null;
      if (location !== null) {
        await res.body?.cancel().catch(() => undefined);
        if (hop >= FETCH_LIMITS.maxRedirects) return refuse(`Too many redirects (at most ${FETCH_LIMITS.maxRedirects})`);
        let next: URL;
        try {
          next = new URL(location, url);
        } catch {
          return refuse("Refused a redirect to a URL that is not valid");
        }
        if (!hostAllowed(next.href, o.hosts)) return refuse("Refused a redirect to an undeclared host");
        const dropBody = res.status === 303 || ((res.status === 301 || res.status === 302) && method === "POST");
        if (next.host !== url.host) {
          if (bodyHasSecret && !dropBody) return refuse("Refused a redirect that would send a key to another host");
          for (const name of [...secretHeaders, ...CREDENTIAL_HEADERS]) headers.delete(name);
          secretHeaders.clear();
        }
        if (dropBody) {
          if (method !== "HEAD") method = "GET";
          body = undefined;
          bodyHasSecret = false;
          for (const name of BODY_HEADERS) headers.delete(name);
        }
        url = next;
        continue;
      }
      const tooLarge = `The response is larger than ${size(maxBytes)}`;
      if (Number(res.headers.get("content-length") ?? 0) > maxBytes) {
        await res.body?.cancel().catch(() => undefined);
        return refuse(tooLarge);
      }
      const bytes = method === "HEAD" ? new Uint8Array() : await readCapped(res, maxBytes);
      if (bytes === null) return refuse(tooLarge);
      const text = new TextDecoder("utf-8").decode(bytes);
      // fromEntries: a header named __proto__ stays a plain property.
      const outHeaders = Object.fromEntries([...res.headers].map(([k, v]) => [clean(k), clean(v)]));
      return { ok: true, response: { url: clean(url.href), status: res.status, ok: res.ok, headers: outHeaders, text: clean(text) } };
    }
  } catch (err) {
    if (timedOut) return refuse(`The request took more than ${duration(timeoutMs)}`);
    if (o.signal?.aborted) return refuse("The sync run ended");
    const e = err as { message?: unknown; cause?: { code?: unknown; message?: unknown } };
    const cause = e?.cause ? ` (${String(e.cause.code ?? e.cause.message ?? "")})` : "";
    return refuse(clean(`The request failed: ${String(e?.message ?? err)}${cause}`).slice(0, 500));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
