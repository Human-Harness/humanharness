import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { HARNESS_ID, TOOLS_MAX, TOOL_ID } from "@humanharness/harness-sdk";
import { PLUGIN_CSP, inside, only, plain, text, tooDeep } from "../plugin-protocol";

/**
 * The tool host window's edges (tools spec §4.1; threat rows T1, T2, T6): what the `hh-tools:` scheme serves, which
 * requests the host's session lets through, which frame `hh-tools:rpc` answers, and the shape of every `rpc` the core
 * host script may send. Pure functions over plain inputs, mirrored from plugin-protocol.ts with tool names:
 * `tool-host.ts` only plugs them into Electron. Everything that reaches them comes from a page that runs tool code.
 */

/** For `protocol.registerSchemesAsPrivileged` before the app is ready: no fetch, CORS or CSP bypass. */
export const TOOL_SCHEME = { scheme: "hh-tools", privileges: { standard: true, secure: true } } as const;

/** Sent on every hh-tools: response, the plugins' text: no network, no frames, no workers, no eval (T1). */
export const TOOL_CSP = PLUGIN_CSP;

/** The largest file the scheme serves (a tool bundle is about 530 KB: zod is bundled whole in each). */
export const TOOL_FILE_MAX_BYTES = 10 * 1024 * 1024;

/** The harness's id as the host name of its scheme: a harness id short enough to be a DNS label. */
const hostId = (id: string): boolean => HARNESS_ID.test(id) && id.length <= 63;

/**
 * The one page the host window loads, and the only one whose main frame `hh-tools:rpc` answers (T2). Its query names
 * the built tools the page imports (tool ids: no escaping needed).
 */
export const toolHostUrl = (id: string, tools: readonly string[]): string => `hh-tools://${id}/_hh/host.html?tools=${tools.join(",")}`;

const CORE: Record<string, { file: string; type: string }> = {
  "host.html": { file: "tool-host.html", type: "text/html" },
  "host.js": { file: "tool-host.mjs", type: "text/javascript" },
};
const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;

/** `url` parsed as an hh-tools: URL of harness `id`, with nothing but scheme, host and path; else null. */
function ownUrl(url: string, id: string): URL | null {
  if (!hostId(id)) return null;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "hh-tools:" || u.hostname !== id || u.username !== "" || u.password !== "" || u.port !== "") return null;
  return u;
}

/**
 * The decoded path segments of `url` as it was written (not as `new URL` normalized it), or null when one is empty,
 * `.`, `..`, a dot-file, or holds `/`, `\` or NUL once decoded.
 */
function segments(url: string, id: string): string[] | null {
  const prefix = `hh-tools://${id}/`;
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

/**
 * The file `url` names, or null (T1): `_hh/host.html` and `_hh/host.js` are the core's files; `tools/<id>.js`, with
 * `<id>` a tool id, is a built tool in `<dist>/tools/`. Nothing else: not tools.json, not a harness's own `dist/_hh/`,
 * not a nested path. The host must be the harness's own id, the path as written has no `..`, `\`, NUL, empty or
 * dot-segment (encoded or not), and its realpath is the plain path inside its folder. Checked on every request.
 */
export async function resolveToolFile(url: string, o: { id: string; dist: string; core: string }): Promise<{ file: string; type: string } | null> {
  if (!ownUrl(url, o.id)) return null;
  const segs = segments(url, o.id);
  if (!segs || segs.length !== 2) return null;
  const [dir, name] = segs as [string, string];
  let root: string;
  let file: string;
  let type: string;
  if (dir === "_hh") {
    if (!Object.hasOwn(CORE, name)) return null;
    root = o.core;
    ({ file, type } = CORE[name]!);
    file = path.join(o.core, file);
  } else if (dir === "tools") {
    if (!name.endsWith(".js") || !TOOL_ID.test(name.slice(0, -3))) return null;
    root = path.join(o.dist, "tools");
    file = path.join(root, name);
    type = "text/javascript";
  } else return null;
  try {
    // The folder itself must be a folder, not a link to one (a tools/ swapped for a link is refused).
    if (!(await fs.lstat(root)).isDirectory()) return null;
    const realRoot = await fs.realpath(root);
    const real = await fs.realpath(file);
    if (!inside(realRoot, real)) return null;
    if (real !== path.join(realRoot, path.relative(root, file))) return null;
    const st = await fs.lstat(real);
    if (!st.isFile() || st.nlink > 1) return null;
    return { file: real, type };
  } catch {
    return null;
  }
}

/**
 * The bytes and type `url` names (resolveToolFile), read through a handle opened without following a link and checked
 * again once open, as readPluginFile: a regular file, not hard-linked, the same file the path names, at most
 * TOOL_FILE_MAX_BYTES. Null for anything else.
 */
export async function readToolFile(url: string, o: { id: string; dist: string; core: string }): Promise<{ body: Buffer; type: string } | null> {
  const hit = await resolveToolFile(url, o);
  if (!hit) return null;
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(hit.file, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
  } catch {
    return null;
  }
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink > 1 || st.size > TOOL_FILE_MAX_BYTES) return null;
    const again = await resolveToolFile(url, o);
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

/** The host window may load only its own harness's hh-tools: files; the session cancels everything else (T1). */
export function allowToolRequest(url: string, id: string): boolean {
  return ownUrl(url, id) !== null;
}

/**
 * `hh-tools:rpc` answers only the host window's main frame showing exactly its host page (T2): an error page after a
 * blocked navigation runs the preload again under the same webContents id, so the frame's URL must match too.
 */
export function isToolFrame(frame: { url: string; isMain: boolean }, id: string, tools: readonly string[]): boolean {
  return frame.isMain && ownUrl(frame.url, id) !== null && frame.url === toolHostUrl(id, tools);
}

/**
 * The harness whose host window an `hh-tools:rpc` comes from, or null: the sender's webContents id must be the
 * registered host window's AND its frame that window's main frame at its own host page. The tool a `ctx` call acts
 * for is never read from the page: it is the call id's, which main made (tool-host.ts).
 */
export function toolOfSender(
  sender: { webContentsId: number; frame: { url: string; isMain: boolean } | null | undefined },
  windows: ReadonlyMap<number, { harness: string; tools: readonly string[] }>,
): string | null {
  const w = windows.get(sender.webContentsId);
  if (w === undefined || !sender.frame) return null;
  return isToolFrame(sender.frame, w.harness, w.tools) ? w.harness : null;
}

/** What the core host script may send over `hh-tools:rpc`, each argument checked. */
export type ToolRpc =
  | { method: "ready"; tools: string[]; errors: { tool: string; error: string }[] }
  | { method: "next" }
  | { method: "done"; callId: string; ok: true; value: unknown; summary?: string }
  | { method: "done"; callId: string; ok: false; error: string }
  | { method: "ctx"; callId: string; name: string; args: unknown[] };

/**
 * `errorChars` bounds an error's raw text: main hides the tool's secret values in it before the trace cuts it (T4),
 * so a value across the cut can't leave its start behind. The host script cuts at the same length.
 */
export const TOOL_RPC_LIMITS = { tools: TOOLS_MAX, errorChars: 16_000, summaryChars: 200, callIdChars: 64, nameChars: 40, args: 8 } as const;

/** The largest `rpc` payload, in UTF-8 bytes: one JSON string (the preload stringifies it), as the plugins'. */
export const TOOL_RPC_MAX_BYTES = 12 * 1024 * 1024;

/** The deepest nesting an `rpc` payload may have, the envelope included. */
export const TOOL_RPC_MAX_DEPTH = 40;

const toolIds = (v: unknown): v is string[] => Array.isArray(v) && v.length <= TOOL_RPC_LIMITS.tools && v.every((x) => typeof x === "string" && TOOL_ID.test(x));

/**
 * One `rpc(method, payload)` from the host window, checked before anything else sees it: `payload` must be a JSON
 * string of at most TOOL_RPC_MAX_BYTES nested at most TOOL_RPC_MAX_DEPTH deep (both checked before parsing), `"null"`
 * for `next`; null when it isn't, when the method is unknown or when any argument has the wrong shape. A `ctx` call's
 * own arguments are the tool broker's to check; a result is the registry's to check against `returns`. Error and
 * summary texts are cut, not refused.
 */
export function parseToolRpc(method: unknown, payload: unknown): ToolRpc | null {
  if (typeof method !== "string" || typeof payload !== "string") return null;
  if (payload.length > TOOL_RPC_MAX_BYTES || Buffer.byteLength(payload, "utf8") > TOOL_RPC_MAX_BYTES) return null;
  if (tooDeep(payload, TOOL_RPC_MAX_DEPTH)) return null;
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
      if (!plain(args) || !only(args, ["tools", "errors"]) || !toolIds(args.tools)) return null;
      const e = args.errors;
      if (!Array.isArray(e) || e.length > TOOL_RPC_LIMITS.tools) return null;
      const errors: { tool: string; error: string }[] = [];
      for (const x of e) {
        if (!plain(x) || !only(x, ["tool", "error"]) || typeof x.tool !== "string" || !TOOL_ID.test(x.tool) || typeof x.error !== "string") return null;
        errors.push({ tool: x.tool, error: x.error.slice(0, TOOL_RPC_LIMITS.errorChars) });
      }
      return { method: "ready", tools: [...args.tools], errors };
    }
    case "done": {
      if (!plain(args) || !text(args.callId, TOOL_RPC_LIMITS.callIdChars)) return null;
      if (args.ok === true) {
        if (!only(args, ["callId", "ok", "value", "summary"])) return null;
        if (args.summary !== undefined && typeof args.summary !== "string") return null;
        const out: Extract<ToolRpc, { method: "done"; ok: true }> = { method: "done", callId: args.callId, ok: true, value: args.value ?? null };
        if (typeof args.summary === "string") out.summary = args.summary.slice(0, TOOL_RPC_LIMITS.summaryChars);
        return out;
      }
      if (args.ok === false) {
        if (!only(args, ["callId", "ok", "error"]) || typeof args.error !== "string") return null;
        return { method: "done", callId: args.callId, ok: false, error: args.error.slice(0, TOOL_RPC_LIMITS.errorChars) };
      }
      return null;
    }
    case "ctx": {
      if (!plain(args) || !only(args, ["callId", "name", "args"])) return null;
      if (!text(args.callId, TOOL_RPC_LIMITS.callIdChars) || !text(args.name, TOOL_RPC_LIMITS.nameChars)) return null;
      if (!Array.isArray(args.args) || args.args.length > TOOL_RPC_LIMITS.args) return null;
      return { method: "ctx", callId: args.callId, name: args.name, args: [...args.args] };
    }
    default:
      return null;
  }
}
