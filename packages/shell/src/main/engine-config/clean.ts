import path from "node:path";
import type { McpServerSpec } from "@humanharness/blocks";

// The allowlists for a scope's engine config (hatches spec §5.2, §5.4; threat model E4, E5, E9). Everything not
// listed is refused naming the key, at hash time, so the person sees it before approving. Every refusal is an Error
// whose message starts with the file name. The results are fresh copies built only from allowlisted keys: nothing
// from the input object (or its prototype) is passed on as is.

export interface CleanContext {
  /** The person's folder (the scope's base), absolute. */
  folder: string;
  /** The scope's linked folders, absolute. */
  linked: string[];
  /** The manifest's `permissions.edit`: under "none" a preset can't allow an edit tool (E5). */
  edit: "folder" | "none";
  /** Core and harness server names a preset server may never take (E9). */
  reserved: ReadonlySet<string>;
}

export interface CommandHook {
  type: "command";
  command: string;
  timeout?: number;
}
export interface HookMatcher {
  matcher?: string;
  hooks: CommandHook[];
}
export type Hooks = Record<string, HookMatcher[]>;

/** settings.json after cleaning: hooks and permissions allow/deny/ask only. */
export interface CleanSettings {
  hooks?: Hooks;
  permissions?: { allow?: string[]; deny?: string[]; ask?: string[] };
}

const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const SERVER_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CREDENTIAL_NAME = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|CREDENTIAL|AUTH)/i;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
/** Tools whose rule specifier is a path (Claude permission rules). */
const PATH_TOOLS = new Set([...EDIT_TOOLS, "Read", "Glob", "Grep"]);
const RULE = /^([A-Za-z][A-Za-z0-9_]*)(?:\((.*)\))?$/s;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");
const refuse = (file: string, message: string): never => {
  throw new Error(`${file}: ${message}`);
};
const keysOf = (file: string, o: Record<string, unknown>, prefix: string): string[] => {
  const keys = Object.keys(o);
  for (const k of keys) if (PROTO_KEYS.has(k)) refuse(file, `${prefix}${k} is not allowed`);
  return keys;
};

// macOS file systems are usually case-insensitive: compare without case to stay on the safe side (as linked-folders.ts).
const norm = (p: string) => path.resolve(p).toLowerCase();
const inside = (child: string, parent: string) => {
  const c = norm(child);
  const p = norm(parent);
  return c === p || c.startsWith(p.endsWith(path.sep) ? p : p + path.sep);
};

/** The hooks shape both Claude and Codex take: event → matchers → command hooks. */
function cleanHooks(file: string, hooks: unknown): Hooks {
  if (!isObject(hooks)) return refuse(file, "hooks must be an object");
  const out: Hooks = {};
  for (const event of keysOf(file, hooks, "hooks.")) {
    const at = `hooks.${event}`;
    const matchers = hooks[event];
    if (!Array.isArray(matchers)) return refuse(file, `${at} must be a list`);
    out[event] = matchers.map((m) => {
      if (!isObject(m)) return refuse(file, `${at}: each entry must be an object`);
      for (const k of Object.keys(m)) if (k !== "matcher" && k !== "hooks") refuse(file, `${at}: ${k} is not allowed`);
      if (m.matcher !== undefined && typeof m.matcher !== "string") refuse(file, `${at}: matcher must be a string`);
      if (!Array.isArray(m.hooks)) return refuse(file, `${at}: hooks must be a list`);
      const list = m.hooks.map((h): CommandHook => {
        if (!isObject(h) || h.type !== "command") return refuse(file, `${at}: only command hooks are allowed`);
        for (const k of Object.keys(h)) if (k !== "type" && k !== "command" && k !== "timeout") refuse(file, `${at}: ${k} is not allowed`);
        if (typeof h.command !== "string" || h.command.trim() === "") return refuse(file, `${at}: command must be a non-empty string`);
        if (h.timeout !== undefined && !(typeof h.timeout === "number" && Number.isFinite(h.timeout) && h.timeout > 0)) {
          return refuse(file, `${at}: timeout must be a positive number`);
        }
        return { type: "command", command: h.command, ...(h.timeout !== undefined ? { timeout: h.timeout } : {}) };
      });
      return { ...(m.matcher !== undefined ? { matcher: m.matcher as string } : {}), hooks: list };
    });
  }
  return out;
}

/** The absolute path a path rule's specifier points at (glob tail cut), or null when it can't be placed safely. */
function rulePath(spec: string, folder: string): string | null {
  // `~/x` is the home folder; `/x` is relative to the settings file, which the engine reads from the snapshot.
  if (spec.startsWith("~") || (spec.startsWith("/") && !spec.startsWith("//"))) return null;
  const base = spec.slice(0, spec.search(/[*?[{]|$/));
  return spec.startsWith("//") ? path.resolve(base.slice(1)) : path.resolve(folder, base);
}

/** settings.json: `hooks` and `permissions.{allow,deny,ask}` pass; `defaultMode` is dropped; the rest is refused (E4, E5). */
export function cleanSettings(raw: unknown, ctx: CleanContext): { settings: CleanSettings; ignored: string[] } {
  const file = "settings.json";
  if (!isObject(raw)) return refuse(file, "must be a JSON object");
  const settings: CleanSettings = {};
  const ignored: string[] = [];
  for (const key of keysOf(file, raw, "")) {
    if (key === "defaultMode") ignored.push(key);
    else if (key === "hooks") settings.hooks = cleanHooks(file, raw.hooks);
    else if (key === "permissions") {
      const p = raw.permissions;
      if (!isObject(p)) return refuse(file, "permissions must be an object");
      const perms: NonNullable<CleanSettings["permissions"]> = {};
      for (const k of keysOf(file, p, "permissions.")) {
        if (k === "defaultMode") ignored.push("permissions.defaultMode");
        else if (k === "allow" || k === "deny" || k === "ask") {
          const rules = p[k];
          if (!isStringList(rules)) return refuse(file, `permissions.${k} must be a list of strings`);
          perms[k] = k === "allow" ? cleanAllow(rules, ctx, ignored) : [...rules];
        } else refuse(file, `permissions.${k} is not allowed`);
      }
      settings.permissions = perms;
    } else refuse(file, `${key} is not allowed`);
  }
  return { settings, ignored };
}

/** Allow rules: edit tools dropped under `edit: "none"`; path rules must stay in the folder or a linked folder (E5). */
function cleanAllow(rules: string[], ctx: CleanContext, ignored: string[]): string[] {
  const kept: string[] = [];
  for (const rule of rules) {
    const m = RULE.exec(rule.trim());
    const tool = m?.[1] ?? "";
    if (ctx.edit === "none" && EDIT_TOOLS.has(tool)) {
      ignored.push(`permissions.allow: ${rule}`);
      continue;
    }
    const spec = m?.[2];
    if (PATH_TOOLS.has(tool) && spec !== undefined && spec !== "") {
      const target = rulePath(spec, ctx.folder);
      if (target === null || ![ctx.folder, ...ctx.linked].some((root) => inside(target, root))) {
        refuse("settings.json", `permissions.allow: ${rule} points outside the folder and its linked folders`);
      }
    }
    kept.push(rule);
  }
  return kept;
}

/** mcp.json: stdio servers only, renamed `scope-<name>`, no credential-looking env names (spec §5.2, E9, Decisions 7–8). */
export function cleanMcp(raw: unknown, ctx: CleanContext): McpServerSpec[] {
  const file = "mcp.json";
  if (!isObject(raw)) return refuse(file, "must be a JSON object");
  for (const k of keysOf(file, raw, "")) if (k !== "mcpServers") refuse(file, `${k} is not allowed`);
  if (raw.mcpServers === undefined) return [];
  if (!isObject(raw.mcpServers)) return refuse(file, "mcpServers must be an object");
  const servers = raw.mcpServers;
  return keysOf(file, servers, "mcpServers.").map((name) => {
    const at = `mcpServers.${name}`;
    if (!SERVER_NAME.test(name)) return refuse(file, `${at}: the name must be lowercase letters, digits and dashes (up to 40)`);
    const renamed = `scope-${name}`;
    if (ctx.reserved.has(renamed)) return refuse(file, `${at}: ${renamed} is a reserved server name`);
    const s = servers[name];
    if (!isObject(s)) return refuse(file, `${at} must be an object`);
    if (Object.hasOwn(s, "url") || (s.type !== undefined && s.type !== "stdio")) return refuse(file, `${at}: url servers are not supported`);
    for (const k of Object.keys(s)) if (!["type", "command", "args", "env"].includes(k)) refuse(file, `${at}.${k} is not allowed`);
    if (typeof s.command !== "string" || s.command.trim() === "" || s.command.startsWith("-")) {
      return refuse(file, `${at}.command must be a program name, not empty and not starting with "-"`);
    }
    if (s.args !== undefined && !isStringList(s.args)) return refuse(file, `${at}.args must be a list of strings`);
    const env: Record<string, string> = {};
    if (s.env !== undefined) {
      if (!isObject(s.env)) return refuse(file, `${at}.env must be an object`);
      for (const k of keysOf(file, s.env, `${at}.env.`)) {
        if (CREDENTIAL_NAME.test(k)) refuse(file, `${at}.env.${k} looks like a credential; credentials are not allowed`);
        const v = s.env[k];
        if (typeof v !== "string") return refuse(file, `${at}.env.${k} must be a string`);
        env[k] = v;
      }
    }
    return { name: renamed, command: s.command, args: s.args ? [...s.args] : [], env };
  });
}

type CodexRule = "string" | "boolean" | "booleans" | "hooks" | { [key: string]: CodexRule };
// Decision 9. The core owns the profile keys (model, effort, compaction), auth and providers; servers go through mcp.json.
const CODEX_ALLOW: { [key: string]: CodexRule } = {
  model_reasoning_summary: "string",
  model_verbosity: "string",
  hide_agent_reasoning: "boolean",
  show_raw_agent_reasoning: "boolean",
  hooks: "hooks",
  tools: { web_search: "boolean" },
  sandbox_workspace_write: { network_access: "boolean" },
  features: "booleans",
};

function cleanCodexTable(o: Record<string, unknown>, rules: { [key: string]: CodexRule }, prefix: string): Record<string, unknown> {
  const file = "codex.toml";
  const out: Record<string, unknown> = {};
  for (const key of keysOf(file, o, prefix)) {
    const at = `${prefix}${key}`;
    if (!Object.hasOwn(rules, key)) refuse(file, `${at} is not allowed`);
    const rule = rules[key];
    const v = o[key];
    if (rule === "string" || rule === "boolean") {
      if (typeof v !== rule) refuse(file, `${at} must be a ${rule}`);
      out[key] = v;
    } else if (rule === "hooks") out[key] = cleanHooks(file, v);
    else if (rule === "booleans") {
      if (!isObject(v)) return refuse(file, `${at} must be a table`);
      const flags: Record<string, boolean> = {};
      for (const k of keysOf(file, v, `${at}.`)) {
        if (typeof v[k] !== "boolean") refuse(file, `${at}.${k} must be true or false`);
        flags[k] = v[k] as boolean;
      }
      out[key] = flags;
    } else {
      if (!isObject(v)) return refuse(file, `${at} must be a table`);
      out[key] = cleanCodexTable(v, rule, `${at}.`);
    }
  }
  return out;
}

/** codex.toml (already parsed): the allowlist of Decision 9; anything else is refused naming the dotted key. */
export function cleanCodex(raw: unknown): Record<string, unknown> {
  if (!isObject(raw)) return refuse("codex.toml", "must be a table");
  return cleanCodexTable(raw, CODEX_ALLOW, "");
}
