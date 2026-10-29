import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { PLUGIN_ID } from "@humanharness/harness-sdk";

/**
 * The plugin backend window's edges (plugins spec §4.1; threat model B2, B3, B4, B5): what the `hh-plugin:` scheme
 * serves, which requests the plugin's session lets through, which frame the plugin channel answers, and the shape of
 * every `rpc` the core host script may send. Pure functions over plain inputs: `plugin-host.ts` only plugs them into
 * Electron. Everything that reaches them comes from a page assumed hostile.
 */

/** Sent as a header on every hh-plugin: response (spec §4.1; spike S3): no network, no frames, no workers (B2). */
export const PLUGIN_CSP = "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The one page a backend window loads, and the only one whose main frame the plugin channel answers (B5). */
export const pluginHostUrl = (id: string): string => `hh-plugin://${id}/_hh/host.html`;

/** The largest file the scheme serves (backend.js is capped at 5 MB when it loads; files may change after that). */
export const PLUGIN_FILE_MAX_BYTES = 10 * 1024 * 1024;

const TYPES: Record<string, string> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".html": "text/html",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".woff2": "font/woff2",
};
const CORE: Record<string, { file: string; type: string }> = {
  "host.html": { file: "plugin-host.html", type: "text/html" },
  "host.js": { file: "plugin-host.mjs", type: "text/javascript" },
};
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;

/** `url` parsed as an hh-plugin: URL of plugin `id`, with nothing but scheme, host and path; else null. */
function ownUrl(url: string, id: string): URL | null {
  if (!PLUGIN_ID.test(id)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "hh-plugin:" || u.hostname !== id || u.username !== "" || u.password !== "" || u.port !== "") return null;
  return u;
}

/**
 * The decoded path segments of `url` as it was written (not as `new URL` normalized it: `_hh/../backend.js` must not
 * become `backend.js`), or null when one is empty, `.`, `..`, a dot-file, or holds `/`, `\` or NUL once decoded.
 */
function segments(url: string, id: string): string[] | null {
  const prefix = `hh-plugin://${id}/`;
  if (!url.startsWith(prefix)) return null;
  const raw = url.slice(prefix.length).split(/[?#]/, 1)[0] ?? "";
  const out: string[] = [];
  for (const part of raw.split("/")) {
    let s: string;
    try {
      s = decodeURIComponent(part);
    } catch {
      return null;
    }
    if (s === "" || s.startsWith(".") || /[/\\\0]/.test(s)) return null;
    out.push(s);
  }
  return out;
}

export const inside = (root: string, file: string): boolean => {
  const rel = path.relative(root, file);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

/**
 * The file `url` names inside plugin `id`'s dist (or the core's `_hh/` files), or null (B3, B4): the host must be
 * the plugin's own id, the path as written has no `..`, `\`, NUL, empty or dot-segment (encoded or not), its
 * extension is allowlisted, and its realpath stays inside `dist`. Checked on every request: the folder may have
 * changed since the plugin loaded. `_hh/` always means the core's files: a plugin's own `dist/_hh/` is never served.
 */
export async function resolvePluginFile(url: string, o: { id: string; dist: string; core: string }): Promise<{ file: string; type: string } | null> {
  if (!ownUrl(url, o.id)) return null;
  const segs = segments(url, o.id);
  if (!segs || segs.length === 0) return null;
  let root: string;
  let file: string;
  let type: string;
  if (segs[0] === "_hh") {
    if (segs.length !== 2 || !Object.hasOwn(CORE, segs[1]!)) return null;
    root = o.core;
    ({ file, type } = CORE[segs[1]!]!);
    file = path.join(o.core, file);
  } else {
    const ext = path.extname(segs[segs.length - 1]!);
    if (!Object.hasOwn(TYPES, ext)) return null;
    root = o.dist;
    file = path.join(o.dist, ...segs);
    type = TYPES[ext]!;
  }
  try {
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(file);
    if (!inside(realRoot, real)) return null;
    // A link inside the folder that points elsewhere inside it is still a link: only plain paths are served.
    if (real !== path.join(realRoot, path.relative(root, file))) return null;
    const st = await fs.lstat(real);
    if (!st.isFile() || st.nlink > 1) return null;
    return { file: real, type };
  } catch {
    return null;
  }
}

/**
 * The bytes and type `url` names (resolvePluginFile), read through a handle opened without following a link and
 * checked again once open: a regular file, not hard-linked, the same file the path names, at most
 * PLUGIN_FILE_MAX_BYTES. Null for anything else. A parent folder swapped for a link between the check and the open
 * is caught by the identity check afterwards, short of a swap back in between (no openat in Node).
 */
export async function readPluginFile(url: string, o: { id: string; dist: string; core: string }): Promise<{ body: Buffer; type: string } | null> {
  const hit = await resolvePluginFile(url, o);
  if (!hit) return null;
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(hit.file, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch {
    return null;
  }
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink > 1 || st.size > PLUGIN_FILE_MAX_BYTES) return null;
    const again = await resolvePluginFile(url, o);
    if (again?.file !== hit.file) return null;
    const now = await fs.lstat(hit.file);
    if (now.ino !== st.ino || now.dev !== st.dev) return null;
    const body = Buffer.alloc(st.size);
    let size = 0;
    while (size < body.length) {
      const { bytesRead } = await handle.read(body, size, body.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    return { body: body.subarray(0, size), type: hit.type };
  } catch {
    return null;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

/** A plugin's own window may load only its own hh-plugin: files; the session cancels everything else (B2, B4; S4). */
export function allowPluginRequest(url: string, id: string): boolean {
  return ownUrl(url, id) !== null;
}

/**
 * The plugin channel answers only the plugin's own window's main frame, showing its host page (B5). The sender's
 * webContents id alone is not enough (spike S9): an error page after a blocked navigation runs the preload again
 * with the same id, so the frame's URL must be the host page too.
 */
export function isPluginFrame(frame: { url: string; isMain: boolean }, id: string): boolean {
  return frame.isMain && ownUrl(frame.url, id) !== null && frame.url === pluginHostUrl(id);
}

/**
 * The plugin an `hh-plugin:rpc` comes from, or null: its webContents id must be a registered backend window's AND
 * its frame that window's main frame at its own host page (isPluginFrame). The identity comes from the sender,
 * never from the call's arguments.
 */
export function pluginOfSender(
  sender: { webContentsId: number; frame: { url: string; isMain: boolean } | null | undefined },
  windows: ReadonlyMap<number, string>,
): string | null {
  const id = windows.get(sender.webContentsId);
  if (id === undefined || !sender.frame) return null;
  return isPluginFrame(sender.frame, id) ? id : null;
}

/** What the core host script may send over `rpc` (Decision 10), each argument checked. */
export type PluginRpc =
  | { method: "ready"; sources: string[] }
  | { method: "ready"; error: string }
  | { method: "next" }
  | { method: "done"; runId: string; ok: boolean; error?: string }
  | { method: "ctx"; runId: string; name: string; args: unknown[] };

/**
 * `errorChars` bounds an error's raw text, far past the 500 characters shown: main hides the plugin's keys in it and
 * only then cuts, so a key across the cut can't leave its start behind (B6). The host script cuts at the same length.
 */
export const RPC_LIMITS = { sources: 100, sourceChars: 64, errorChars: 16_000, runIdChars: 64, nameChars: 40, args: 8 } as const;

/**
 * The largest `rpc` payload, in UTF-8 bytes. The payload crosses IPC as one JSON string (the preload stringifies it):
 * structured clone keeps shared references, so a small message holding one big string many times would blow up in
 * main; a string has none, and its size is what it costs.
 */
export const RPC_MAX_BYTES = 12 * 1024 * 1024;

/** The deepest nesting an `rpc` payload may have: the broker's 32 for a call's arguments, plus the envelope. */
export const RPC_MAX_DEPTH = 40;

/**
 * Whether `json` nests deeper than `max`, counted in one pass over the text (brackets inside strings skipped), so a
 * deeply nested payload is refused before JSON.parse spends time on it or a recursive reader overflows on its result.
 */
export function tooDeep(json: string, max: number): boolean {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < json.length; i++) {
    const c = json.charCodeAt(i);
    if (inString) {
      if (c === 0x5c) i++; // backslash: skip the escaped character
      else if (c === 0x22) inString = false;
    } else if (c === 0x22) inString = true;
    else if (c === 0x5b || c === 0x7b) {
      if (++depth > max) return true;
    } else if (c === 0x5d || c === 0x7d) depth--;
  }
  return false;
}

export const plain = (v: unknown): v is Record<string, unknown> => {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};
export const only = (v: Record<string, unknown>, keys: readonly string[]): boolean => Object.keys(v).every((k) => keys.includes(k));
export const text = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;

/**
 * One `rpc(method, payload)` from a backend window, checked before anything else sees it: `payload` must be a JSON
 * string of at most RPC_MAX_BYTES (`"null"` for `next`), parsed here; null when it isn't, when the method is unknown
 * or when any argument has the wrong shape. Only the envelope is checked here: a `ctx` call's own arguments are the
 * broker's to check, against the call they belong to (PluginBroker.call). An error text is cut, not refused.
 */
export function parsePluginRpc(method: unknown, payload: unknown): PluginRpc | null {
  if (typeof method !== "string" || typeof payload !== "string") return null;
  // A UTF-16 unit is at least one UTF-8 byte: the cheap length check first, the exact count after.
  if (payload.length > RPC_MAX_BYTES || Buffer.byteLength(payload, "utf8") > RPC_MAX_BYTES) return null;
  if (tooDeep(payload, RPC_MAX_DEPTH)) return null;
  let args: unknown;
  try {
    args = JSON.parse(payload);
  } catch {
    return null;
  }
  switch (method) {
    case "next":
      return args === null ? { method: "next" } : null;
    case "ready": {
      if (!plain(args)) return null;
      if (only(args, ["error"]) && typeof args.error === "string") return { method: "ready", error: args.error.slice(0, RPC_LIMITS.errorChars) };
      const s = args.sources;
      if (!only(args, ["sources"]) || !Array.isArray(s) || s.length > RPC_LIMITS.sources) return null;
      if (!s.every((x) => text(x, RPC_LIMITS.sourceChars))) return null;
      return { method: "ready", sources: [...(s as string[])] };
    }
    case "done": {
      if (!plain(args) || !only(args, ["runId", "ok", "error"])) return null;
      if (!text(args.runId, RPC_LIMITS.runIdChars) || typeof args.ok !== "boolean") return null;
      if (args.error !== undefined && typeof args.error !== "string") return null;
      const out: PluginRpc = { method: "done", runId: args.runId, ok: args.ok };
      if (typeof args.error === "string") out.error = args.error.slice(0, RPC_LIMITS.errorChars);
      return out;
    }
    case "ctx": {
      if (!plain(args) || !only(args, ["runId", "name", "args"])) return null;
      if (!text(args.runId, RPC_LIMITS.runIdChars) || !text(args.name, RPC_LIMITS.nameChars)) return null;
      if (!Array.isArray(args.args) || args.args.length > RPC_LIMITS.args) return null;
      return { method: "ctx", runId: args.runId, name: args.name, args: [...args.args] };
    }
    default:
      return null;
  }
}
