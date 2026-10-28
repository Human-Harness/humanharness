import { EXEC_CMD, HOST_PATTERN, type PluginPermissions } from "./plugin";

/**
 * The permission checks of plugins (plugins spec §4.2, §7; threat model B6, B7, B8): pure functions the broker (main)
 * and part 2's `check` share. Plugin input is hostile here: every check refuses unless it can prove the call is one the
 * person approved. No Node API (the SDK index also reaches the renderer), no regex built from plugin input.
 */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const SECRET_REF = /\{\{secret:([a-z][a-z0-9_-]{0,39})\}\}/g;
/** Anything that starts like a reference; what is left of it once the valid ones are gone is malformed. */
const SECRET_LIKE = /\{\{\s*secret/i;
const ARG_MAX = 4096;
const ARGS_MAX = 256;
export const REDACTED = "[redacted]";

/** A host pattern split into its name and port (`""`: the default one; `443` is the default too). */
function splitPattern(pattern: string): { name: string; port: string } | null {
  const p = pattern.toLowerCase();
  if (!HOST_PATTERN.test(p)) return null;
  const [name, port = ""] = p.split(":");
  return { name, port: port === "443" ? "" : port };
}

/**
 * `url` may be fetched under `patterns` (§4.2, Decision 8): https only, no user info, no IP literal or localhost, the
 * host exact or under a `*.` pattern (one label or more), the default port unless the pattern names one. The URL parser
 * has already lower-cased the host, turned an IDN into punycode and a numeric host (`0x7f.1`) into dotted IPv4.
 */
export function hostAllowed(url: string, patterns: readonly string[]): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username !== "" || u.password !== "") return false;
  const host = u.hostname.replace(/\.$/, "");
  if (host === "" || host.split(".").includes("") || host.startsWith("[") || IPV4.test(host)) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  return patterns.some((pattern) => {
    const p = splitPattern(pattern);
    if (p === null || p.port !== u.port) return false;
    if (!p.name.startsWith("*.")) return host === p.name;
    const suffix = p.name.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  });
}

/** Spellings of one option some tools take (gh `-X`/`--method`, curl `-X`/`--request`): pinning one pins them all. */
const FLAG_ALIASES: readonly (readonly string[])[] = [["-X", "--method", "--request"]];

/** The options a pattern pins before its `*`, aliases included (`--method=GET` pins `--method`). */
function pinnedFlags(prefix: readonly string[]): Set<string> {
  const flags = new Set(prefix.filter((t) => t.startsWith("-")).map((t) => (t.startsWith("--") ? t.split("=")[0] : t.slice(0, 2))));
  for (const group of FLAG_ALIASES) if (group.some((f) => flags.has(f))) for (const f of group) flags.add(f);
  return flags;
}

/**
 * A token after the `*` may not set again an option the prefix pins (Open question 2). Long options: the same name or
 * an abbreviation of it (`--meth=POST`, and `--` itself) is refused. Short options can be grouped (`-vXPOST`), so once
 * the prefix pins anything, every short option after the `*` is refused.
 */
function overridesPin(token: string, pinned: ReadonlySet<string>): boolean {
  if (pinned.size === 0 || !token.startsWith("-") || token === "-") return false;
  if (!token.startsWith("--")) return true;
  const name = token.split("=")[0];
  return [...pinned].some((f) => f.startsWith("--") && f.startsWith(name));
}

/** The ways a gh pattern pins GET; read-only is claimed only for `gh api <one of these> *`, nothing else. */
const GH_GET_PINS: readonly (readonly string[])[] = [["--method", "GET"], ["-X", "GET"], ["--method=GET"], ["-XGET"]];

/** Long options of `gh api` that send a body, a file or the token elsewhere: refused after a read-only pattern's `*`. */
const READ_ONLY_REFUSED = ["--input", "--field", "--raw-field", "--hostname", "--header"];

/**
 * The pattern is `gh api` with GET pinned and a final `*`: the one shape the review calls read-only. Any other pattern
 * (curl included: `--next`, `--output`, `--upload-file` make a GET pin meaningless) is shown without that claim.
 */
function readOnlyShape(p: { cmd: string; args: readonly string[] }): boolean {
  if (p.cmd !== "gh" || p.args[0] !== "api" || p.args.at(-1) !== "*") return false;
  const pin = p.args.slice(1, -1);
  return GH_GET_PINS.some((g) => g.length === pin.length && g.every((t, i) => pin[i] === t));
}

/**
 * A token after a read-only pattern's `*` that could write, read a local file or leave github.com: any short option, a
 * long one naming or abbreviating READ_ONLY_REFUSED (`--` too), an absolute URL anywhere, an `@file` argument.
 */
function breaksReadOnly(token: string): boolean {
  if (token.includes("://") || token.startsWith("@")) return true;
  if (!token.startsWith("-") || token === "-") return false;
  if (!token.startsWith("--")) return true;
  const name = token.split("=")[0];
  return READ_ONLY_REFUSED.some((f) => f.startsWith(name));
}

/**
 * `cmd args` matches one approved pattern (§4.2, Decision 9): literal tokens, a final `*` for one or more. A read-only
 * pattern (readOnlyShape) also refuses, after its `*`, whatever breaksReadOnly names.
 */
export function execAllowed(cmd: string, args: readonly string[], patterns: PluginPermissions["exec"]): boolean {
  if (!EXEC_CMD.test(cmd) || args.length > ARGS_MAX) return false;
  if (args.some((a) => typeof a !== "string" || a.length > ARG_MAX || a.includes("\0") || SECRET_LIKE.test(a))) return false;
  return patterns.some((p) => {
    if (p.cmd !== cmd) return false;
    const wild = p.args.at(-1) === "*";
    const prefix = wild ? p.args.slice(0, -1) : p.args;
    if (prefix.includes("*")) return false;
    if (wild ? args.length <= prefix.length : args.length !== prefix.length) return false;
    if (!prefix.every((t, i) => args[i] === t)) return false;
    const pinned = pinnedFlags(prefix);
    const tail = args.slice(prefix.length);
    if (readOnlyShape(p) && tail.some(breaksReadOnly)) return false;
    return tail.every((a) => !overridesPin(a, pinned));
  });
}

/** The secret ids `text` references, in order. */
export const secretRefs = (text: string): string[] => [...text.matchAll(SECRET_REF)].map((m) => m[1]);

export type FillResult = { ok: true; text: string; used: string[] } | { ok: false; reason: string };

/**
 * Replaces each `{{secret:<id>}}` with its stored value in one pass (a value is never filled again); a reference to a
 * key not in `values`, or anything else that looks like one, is refused (a typo never leaks out as text).
 */
export function fillSecrets(text: string, values: Readonly<Record<string, string>>): FillResult {
  for (const id of secretRefs(text)) {
    if (!Object.hasOwn(values, id)) return { ok: false, reason: `The key "${id}" is not stored` };
  }
  if (SECRET_LIKE.test(text.replace(SECRET_REF, ""))) return { ok: false, reason: "A key reference is malformed: write {{secret:<id>}}" };
  const used = new Set<string>();
  const filled = text.replace(SECRET_REF, (_, id: string) => {
    used.add(values[id]);
    return values[id];
  });
  return { ok: true, text: filled, used: [...used] };
}

function base64(value: string): string {
  let bin = "";
  for (const byte of new TextEncoder().encode(value)) bin += String.fromCharCode(byte);
  return btoa(bin);
}

const lowerHex = (s: string) => s.replace(/%[0-9A-F]{2}/g, (m) => m.toLowerCase());

/**
 * The forms a value may come back in: raw, JSON-escaped, URL-encoded and form-encoded (either hex case), base64 and
 * base64url, padded or not.
 */
function redactForms(value: string): string[] {
  const encoded = encodeURIComponent(value);
  const form = new URLSearchParams({ x: value }).toString().slice(2);
  const b64 = base64(value);
  const url = b64.replaceAll("+", "-").replaceAll("/", "_");
  const json = JSON.stringify(value).slice(1, -1);
  return [value, json, encoded, lowerHex(encoded), form, lowerHex(form), b64, b64.replace(/=+$/, ""), url, url.replace(/=+$/, "")];
}

/** Every value, in every form, replaced by `[redacted]` (B6); the longest first, so no part of a value is left. */
export function redact(text: string, values: readonly string[]): string {
  const forms = [...new Set(values.filter((v) => v !== "").flatMap(redactForms))].filter((f) => f !== "").sort((a, b) => b.length - a.length);
  let out = text;
  for (const form of forms) out = out.split(form).join(REDACTED);
  return out;
}

export type AddedPermission = { kind: "host" | "exec" | "secret" | "tasks"; value: string };

/**
 * An approved host pattern covers `next`: the same once normalized (`x.com` is `x.com:443`), or a `*.` pattern over a
 * host or narrower wildcard, same port.
 */
function hostCovered(approved: string, next: string): boolean {
  if (approved === next) return true;
  const a = splitPattern(approved);
  const n = splitPattern(next);
  if (a === null || n === null || a.port !== n.port) return false;
  if (a.name === n.name) return true;
  if (!a.name.startsWith("*.")) return false;
  const suffix = a.name.slice(1);
  const base = n.name.startsWith("*.") ? n.name.slice(1) : n.name;
  return base.endsWith(suffix) && base.length > suffix.length;
}

/** What `next` adds to `approved` (Decision 6); empty: no review needed. An exec pattern must be identical. */
export function permissionsAdded(approved: PluginPermissions, next: PluginPermissions): AddedPermission[] {
  const added: AddedPermission[] = [];
  for (const h of next.hosts) if (!approved.hosts.some((a) => hostCovered(a, h))) added.push({ kind: "host", value: h });
  const key = (e: { cmd: string; args: readonly string[] }) => JSON.stringify([e.cmd, ...e.args]);
  const approvedExec = new Set(approved.exec.map(key));
  for (const e of next.exec) if (!approvedExec.has(key(e))) added.push({ kind: "exec", value: [e.cmd, ...e.args].join(" ") });
  const approvedSecrets = new Set(approved.secrets.map((s) => s.id));
  for (const s of next.secrets) if (!approvedSecrets.has(s.id)) added.push({ kind: "secret", value: s.id });
  if (next.tasks && !approved.tasks) added.push({ kind: "tasks", value: "true" });
  return added;
}

export type PermissionLine =
  | { kind: "hosts"; hosts: string[] }
  | { kind: "exec"; command: string; readOnly: boolean; wide: boolean }
  | { kind: "secrets"; labels: string[] }
  | { kind: "tasks" };

/**
 * The permission review in plain data (§7); the UI words it. `command` is the whole pattern, except for a read-only or a
 * wide one: then the command and its leading literal tokens (up to the first option or `*`). `readOnly` only for
 * `gh api` with GET pinned and a final `*` (readOnlyShape), whose tail execAllowed restricts.
 */
export function permissionLines(p: PluginPermissions): PermissionLine[] {
  const lines: PermissionLine[] = [];
  if (p.hosts.length > 0) lines.push({ kind: "hosts", hosts: [...p.hosts] });
  for (const e of p.exec) {
    const readOnly = readOnlyShape(e);
    const wide = e.args.length === 1 && e.args[0] === "*";
    const stop = e.args.findIndex((a) => a === "*" || a.startsWith("-"));
    const literal = readOnly || wide ? e.args.slice(0, stop) : e.args;
    lines.push({ kind: "exec", command: [e.cmd, ...literal].join(" "), readOnly, wide });
  }
  if (p.secrets.length > 0) lines.push({ kind: "secrets", labels: p.secrets.map((s) => s.label) });
  if (p.tasks) lines.push({ kind: "tasks" });
  return lines;
}
