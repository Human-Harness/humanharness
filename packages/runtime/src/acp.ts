import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import { type Effort, type ModelChoice, type ModelProfile, isCap, isEffort, isModelId } from "@humanharness/engines";
import type { Permissions } from "@humanharness/harness-sdk";
import { classifyError } from "./classify";
import { type ActivityKind, EDIT_PATH_MAX, type Event, fail } from "./events";
import type { EnginePreset, LinkedAccess, Transport, TransportOptions, TurnScope } from "./transport";

type PermissionOption = { optionId: string; kind: string };
type PermissionRequest = {
  toolCall: {
    toolCallId: string;
    title?: string | null;
    kind?: string | null;
    locations?: { path: string }[] | null;
    rawInput?: unknown;
  };
  options: PermissionOption[];
  _meta?: Record<string, unknown> | null;
};
type PermissionResponse = { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } };

export interface PermissionPolicy {
  folder: string;
  /** Reference folders: reads and searches there are allowed, never edits. */
  readRoots?: string[];
  /** Linked write folders (hatches §3.3): edits allowed there, except in their own config (L3). */
  writeRoots?: string[];
  permissions: Permissions;
  /** No reading or searching at all, even inside the folder (see `TransportOptions.mcpOnly`). */
  mcpOnly?: boolean;
  /** MCP servers the harness configured (always includes "ui"). */
  mcpServers: string[];
  /** Earlier tool_call info by id (Codex permission requests carry only the id). */
  lookup: (toolCallId: string) => { server?: string } | undefined;
}

const UI_TITLE = /^mcp(__|\.)ui(__|\.)/;

const GRACE_MS = 5000;
const KILL_MS = 3000;
const STDERR_KEEP = 4096;

class OutdatedAdapterError extends Error {}

/** What Codex titles its own compaction step. */
const COMPACT_TITLE = "Compact conversation";

class ModelUnavailableError extends Error {}

function versionLess(a: string, b: string): boolean {
  const parse = (v: string) => v.split(/[-+]/)[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return false;
}

function serverOf(rawInput: unknown): string | undefined {
  const server = (rawInput as { server?: unknown } | null | undefined)?.server;
  return typeof server === "string" ? server : undefined;
}

/** Block tools of the core `ui` MCP server, as Claude (`mcp__ui__x`) or Codex (`mcp.ui.x`, rawInput.server) report them. */
export function isUiTool(title: string | null | undefined, rawInput: unknown): boolean {
  return serverOf(rawInput) === "ui" || UI_TITLE.test(title ?? "");
}

function inside(folder: string, target: string): boolean {
  const root = path.resolve(folder);
  const resolved = path.resolve(root, target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** A write root's own config and git: never edited by the agent (hatches spec §3.3, L3). */
const ROOT_CONFIG = [".git", ".codex", ".agents", ".opencode", ".claude"];

/** `target` is strictly under `root` and not in its config (L3); compared without case, as APFS and NTFS do. */
function underNotConfig(root: string, target: string): boolean {
  if (!inside(root, target)) return false;
  const rel = path.relative(path.resolve(root), path.resolve(root, target));
  // The root itself is never edited, moved or deleted.
  return rel !== "" && !ROOT_CONFIG.includes(rel.split(path.sep)[0].toLowerCase());
}

/** A link whose target is missing: writing through it would create a file wherever it points. */
function dangling(p: string): boolean {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** `p` with its deepest existing part resolved through links (what the engine would write); null when that fails. */
function realDeepest(p: string): string | null {
  let head = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...tail);
    } catch (err) {
      const parent = path.dirname(head);
      if ((err as { code?: unknown }).code !== "ENOENT" || parent === head || dangling(head)) return null;
      tail.unshift(path.basename(head));
      head = parent;
    }
  }
}

function editAllowed(policy: PermissionPolicy, target: string): boolean {
  if (inside(policy.folder, target)) return true;
  const roots = (policy.writeRoots ?? []).filter((r) => inside(r, target));
  if (roots.length === 0) return false;
  // Every containing root (they may overlap), as written and through links: `app/g -> .git` or `app/out -> /elsewhere` is refused.
  const real = realDeepest(target);
  return (
    real !== null &&
    roots.every((r) => {
      const realRoot = realDeepest(r);
      return underNotConfig(r, target) && realRoot !== null && underNotConfig(realRoot, real);
    })
  );
}

/** Answers ACP permission requests from the harness manifest, without asking the user. Never picks "always" options. */
export function decidePermission(params: PermissionRequest, policy: PermissionPolicy): PermissionResponse {
  const { toolCallId, kind, locations, rawInput } = params.toolCall;
  // rawInput is model-written: only the recorded server of a trusted tool_call counts.
  const recorded = params._meta?.is_mcp_tool_approval === true ? policy.lookup(toolCallId)?.server : undefined;
  let allow: boolean;
  if (recorded !== undefined) {
    const server = recorded;
    allow = server !== undefined && policy.mcpServers.includes(server);
  } else {
    switch (kind) {
      case "read":
      case "search":
      case "think":
        allow = !policy.mcpOnly && (locations ?? []).every((l) => [policy.folder, ...(policy.readRoots ?? [])].some((root) => inside(root, l.path)));
        break;
      case "edit":
      case "delete":
      case "move":
        allow = policy.permissions.edit === "folder" && (locations ?? []).length > 0 && (locations ?? []).every((l) => editAllowed(policy, l.path));
        break;
      case "fetch":
        allow = policy.permissions.web;
        break;
      default: // "execute", "other", unknown
        allow = policy.permissions.exec;
    }
  }
  const option = params.options.find((o) => o.kind === (allow ? "allow_once" : "reject_once"));
  return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } };
}

const KINDS: Record<string, ActivityKind> = {
  read: "read", search: "search", edit: "edit", delete: "edit", move: "edit", fetch: "web", execute: "exec",
};

/** An absolute (or home-relative) path starting a word: `/Users/x/a.md`, `~/a.md`, `C:\\x\\a.md`. */
const ABSOLUTE_PATH = /(?<![^\s'"`(])(?:~|[A-Za-z]:)?[\\/][^\s'"`)]*/g;
const FILE_KINDS = new Set(["read", "edit", "delete", "move"]);
const LEADING_VERB = /^(?:read|reading|view|open|edit|write|create|delete|remove|move|rename|update)(?:\s+files?)?\s*:?\s+/i;

function baseName(p: string): string {
  return path.posix.basename(p.replace(/\\/g, "/").replace(/\/+$/, "")) || p;
}

function pathOf(locations: unknown, rawInput: unknown): string | undefined {
  const first = Array.isArray(locations) ? (locations[0] as { path?: unknown } | undefined)?.path : undefined;
  if (typeof first === "string" && first) return first;
  const input = (rawInput ?? {}) as Record<string, unknown>;
  for (const key of ["path", "file_path", "abs_path", "filePath"]) {
    if (typeof input[key] === "string" && input[key]) return input[key] as string;
  }
  const parsed = Array.isArray(input.parsed_cmd) ? (input.parsed_cmd[0] as Record<string, unknown> | undefined) : undefined;
  if (typeof parsed?.path === "string" && parsed.path) return parsed.path;
  if (typeof parsed?.name === "string" && parsed.name) return parsed.name;
  return undefined;
}

/**
 * What an activity line shows for an ACP tool call, in the style of Claude's ("manifest.md"):
 * the file's name for file tools, otherwise the title without absolute paths (they leak the home folder).
 */
export function activityDetail(call: { kind?: unknown; title?: unknown; locations?: unknown; rawInput?: unknown }): string {
  const kind = typeof call.kind === "string" ? call.kind : "";
  const fileKind = FILE_KINDS.has(kind);
  const where = pathOf(call.locations, call.rawInput);
  if (fileKind && where) return baseName(where);
  const title = String(call.title ?? "")
    .replace(ABSOLUTE_PATH, (p) => baseName(p))
    .trim();
  if (!fileKind) return title;
  const rest = title.replace(LEADING_VERB, "").replace(/^['"`](.*)['"`]$/, "$1");
  return rest && !/\s/.test(rest) ? baseName(rest) : rest || title;
}

const EDIT_KINDS = new Set(["edit", "delete", "move"]);
/** The most paths kept from one tool call. */
const EDITS_MAX = 50;

/**
 * The files an ACP edit, delete or move call names: its `locations` and its `diff` contents' paths (parallel spec §5.2).
 * Codex gives no `locations` for an edit: the path is only in `content[].diff.path`, absolute and in the form of the
 * `cwd` it was given, not its real path; and Codex often writes through the shell (`execute`), naming no path at all
 * (spike PT-S3, docs/spikes/2026-10-28-parallel-tasks.md). So this is a hint, never the full list of changed files.
 */
export function acpEditPaths(call: { kind?: unknown; locations?: unknown; content?: unknown }): string[] {
  if (typeof call.kind !== "string" || !EDIT_KINDS.has(call.kind)) return [];
  const out = new Set<string>();
  const add = (p: unknown) => {
    if (typeof p === "string" && p && p.length <= EDIT_PATH_MAX && out.size < EDITS_MAX) out.add(p);
  };
  if (Array.isArray(call.locations)) for (const l of call.locations) add((l as { path?: unknown } | null)?.path);
  if (Array.isArray(call.content)) {
    for (const c of call.content) if ((c as { type?: unknown } | null)?.type === "diff") add((c as { path?: unknown }).path);
  }
  return [...out];
}

/** Longest server or tool name kept. */
const NAME_MAX = 100;
/** Longest engine path kept; a longer one is dropped. */
const PATH_MAX = 4096;
/** How many locations of one call are kept. */
const LOCATIONS_MAX = 20;

/**
 * What an ACP tool call adds to its start event (context-panel spec §3.2): a read or search call's `locations`, or the
 * trusted MCP server (only from Codex's own marker, as `server` is passed) with `rawInput.tool`.
 */
export function acpExtras(call: { kind?: unknown; locations?: unknown; rawInput?: unknown }, server: string | undefined): { paths?: string[]; tool?: { server: string; name: string } } {
  if (server !== undefined) {
    const name = (call.rawInput as { tool?: unknown } | null | undefined)?.tool;
    return { tool: { server: server.slice(0, NAME_MAX), name: typeof name === "string" ? name.slice(0, NAME_MAX) : "" } };
  }
  if (call.kind !== "read" && call.kind !== "search") return {};
  const paths = Array.isArray(call.locations)
    ? call.locations
        .slice(0, LOCATIONS_MAX)
        .map((l) => (l as { path?: unknown } | null)?.path)
        .filter((p): p is string => typeof p === "string" && p.length > 0 && p.length <= PATH_MAX)
    : [];
  return paths.length > 0 ? { paths } : {};
}

/**
 * The adapter's `CODEX_CONFIG` for a task's profile (resources spec §5.2): only these keys are ever
 * written; `model` is left out for the engine's default model. Checked again here before it is used.
 */
export function codexConfig(profile: ModelProfile, preset?: Record<string, unknown>): string {
  if (profile.model !== undefined && !isModelId(profile.model)) {
    throw new Error(`Refusing a model id that reads as a flag: ${JSON.stringify(profile.model)}`);
  }
  if (!isEffort(profile.effort)) throw new Error(`Unknown effort: ${JSON.stringify(profile.effort)}`);
  if (!isCap(profile.cap)) throw new Error(`Context cap out of range: ${JSON.stringify(profile.cap)}`);
  const core = {
    ...(profile.model !== undefined ? { model: profile.model } : {}),
    model_reasoning_effort: profile.effort,
    model_auto_compact_token_limit: profile.cap,
  };
  return JSON.stringify(preset === undefined ? core : mergeCodex(core, preset));
}

/** The keys the core owns in `CODEX_CONFIG` (the profile's): a preset never sets them, even when the profile leaves one out. */
const PROFILE_KEYS = new Set(["model", "model_reasoning_effort", "model_auto_compact_token_limit"]);
const PROTO_KEYS = new Set(["__proto__", "constructor", "prototype"]);

function plainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** A fresh copy of a JSON value from a preset, refusing prototype keys at any depth. */
function copyJson(v: unknown, at: string): unknown {
  if (Array.isArray(v)) return v.map((x, i) => copyJson(x, `${at}[${i}]`));
  if (!plainObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(v)) {
    if (PROTO_KEYS.has(k)) throw new Error(`Refusing the engine preset's codex key ${at}.${k}`);
    Object.defineProperty(out, k, { value: copyJson(v[k], `${at}.${k}`), enumerable: true, writable: true, configurable: true });
  }
  return out;
}

function mergeInto(core: Record<string, unknown>, preset: Record<string, unknown>, at: string): Record<string, unknown> {
  const out = copyJson(core, at) as Record<string, unknown>;
  for (const k of Object.keys(preset)) {
    if (PROTO_KEYS.has(k)) throw new Error(`Refusing the engine preset's codex key ${at ? `${at}.` : ""}${k}`);
    const key = at ? `${at}.${k}` : k;
    if (!Object.hasOwn(out, k)) {
      Object.defineProperty(out, k, { value: copyJson(preset[k], key), enumerable: true, writable: true, configurable: true });
    } else if (plainObject(out[k]) && plainObject(preset[k])) {
      out[k] = mergeInto(out[k] as Record<string, unknown>, preset[k] as Record<string, unknown>, key);
    }
    // Otherwise the core's value stays.
  }
  return out;
}

/**
 * A scope's cleaned `codex.toml` (hatches spec §5.2) merged under the core's `CODEX_CONFIG`: deep, the core's keys
 * first and winning at every depth. The profile's keys are refused outright (the shell's cleaner already refuses
 * them: a last guard).
 */
export function mergeCodex(core: Record<string, unknown>, preset: Record<string, unknown>): Record<string, unknown> {
  for (const k of Object.keys(preset)) {
    if (PROFILE_KEYS.has(k)) throw new Error(`Refusing the engine preset's codex key ${k}: the task's profile sets it`);
  }
  return mergeInto(core, preset, "");
}

/** A preset server's name: `scope-<name>` (hatches spec §5.2, E9). */
const PRESET_SERVER = /^scope-[a-z0-9][a-z0-9-]{0,39}$/;

/** Last guards on a turn's preset (the shell builds it from an approved snapshot): never more than a task session takes. */
function checkPreset(preset: EnginePreset, o: TransportOptions): void {
  if (o.noTools || o.mcpOnly) throw new Error("Refusing an engine preset on a session without tools");
  const core = new Set(o.mcp.map((s) => s.name));
  for (const s of preset.servers) {
    if (!PRESET_SERVER.test(s.name) || core.has(s.name)) throw new Error(`Refusing the engine preset's server name ${JSON.stringify(s.name)}`);
  }
}

type SelectOption = { value?: unknown; name?: unknown; description?: unknown };

/** The options of an ACP select config option, flat or grouped. */
function selectOptions(configOptions: unknown[], id: string): SelectOption[] | null {
  const option = configOptions.find((o): o is Record<string, unknown> => typeof o === "object" && o !== null && (o as { id?: unknown }).id === id);
  if (!option || option.type !== "select" || !Array.isArray(option.options)) return null;
  return (option.options as unknown[]).flatMap((o) => {
    if (typeof o !== "object" || o === null) return [];
    const group = o as { options?: unknown };
    return Array.isArray(group.options) ? (group.options as SelectOption[]) : [o as SelectOption];
  });
}

/**
 * The id of the effort select: Codex's `reasoning_effort`, OpenCode's `effort`, or else the first select of
 * category `thought_level`. Ids first, so Codex's pick never depends on categories (D0).
 */
function effortOptionId(configOptions: unknown[]): string | undefined {
  const ids = configOptions.map((o) => (typeof o === "object" && o !== null ? (o as { id?: unknown; category?: unknown }) : {}));
  for (const id of ["reasoning_effort", "effort"]) if (ids.some((o) => o.id === id)) return id;
  const byCategory = ids.find((o) => o.category === "thought_level" && typeof o.id === "string");
  return byCategory?.id as string | undefined;
}

/** An invalid params error's data names a refused config value (OpenCode: modelId, effort or configId). */
function namesConfigValue(data: unknown): boolean {
  return typeof data === "object" && data !== null && ["modelId", "effort", "configId"].some((k) => k in data);
}

/** The current value of a select config option, when it is a string. */
function currentValue(configOptions: unknown[], id: string): string | undefined {
  const option = configOptions.find((o) => typeof o === "object" && o !== null && (o as { id?: unknown }).id === id) as { currentValue?: unknown } | undefined;
  return typeof option?.currentValue === "string" ? option.currentValue : undefined;
}

/**
 * The models and efforts an ACP agent offers, from session/new `configOptions` (Codex: the selects
 * "model" and "reasoning_effort"; OpenCode: "model" and "effort"). Unsafe ids and unknown efforts are
 * dropped. Null without models.
 */
/** Every safe model id the agent offers, uncut (the profile check needs them all; Settings shows the first 50). */
function offeredModelIds(configOptions: unknown[]): string[] {
  return (selectOptions(configOptions, "model") ?? []).map((o) => o.value).filter((v): v is string => isModelId(v));
}

export function offeredModels(configOptions: unknown): { models: ModelChoice[]; efforts: Effort[] } | null {
  if (!Array.isArray(configOptions)) return null;
  const models = (selectOptions(configOptions, "model") ?? [])
    .filter((o): o is SelectOption & { value: string } => isModelId(o.value))
    .slice(0, 50)
    .map((o) => ({
      id: o.value,
      ...(typeof o.name === "string" && o.name ? { name: o.name.slice(0, 80) } : {}),
      ...(typeof o.description === "string" && o.description ? { description: o.description.slice(0, 200) } : {}),
    }));
  if (models.length === 0) return null;
  const effortId = effortOptionId(configOptions);
  const efforts = (effortId ? (selectOptions(configOptions, effortId) ?? []) : []).map((o) => o.value).filter(isEffort);
  return { models, efforts };
}

function errorFrom(e: unknown, stderr = ""): Event {
  const err = e as { code?: unknown; message?: string };
  if (e instanceof ModelUnavailableError) return fail("model-unavailable", e.message);
  if (err?.code === "ENOENT") return fail("engine-not-installed", err.message);
  if (e instanceof OutdatedAdapterError) return fail("outdated-version", e.message);
  if (e instanceof acp.RequestError && e.code === -32000) return fail("session-expired", e.message);
  const message = err?.message ?? String(e);
  // A plain (non-RPC) error means the connection closed under us: the agent's stderr says why.
  if (!(e instanceof acp.RequestError) && stderr.trim()) return fail(classifyError(`${message}\n${stderr}`), stderr.trim());
  return fail(classifyError(message), message);
}

/** A `usage_update` cost in USD: a finite amount ≥ 0 in "USD", else undefined (spec §4: other currencies are not recorded). */
export function usdCost(cost: unknown): number | undefined {
  const c = cost as { amount?: unknown; currency?: unknown } | null | undefined;
  return c && c.currency === "USD" && typeof c.amount === "number" && Number.isFinite(c.amount) && c.amount >= 0 ? c.amount : undefined;
}

type AcpUsage = { inputTokens?: number; outputTokens?: number; cachedReadTokens?: number; cachedWriteTokens?: number };

/** Long-lived ACP agent per window; one `session/prompt` per turn. */
export class AcpTransport implements Transport {
  private child?: ChildProcess;
  private conn?: acp.ClientConnection;
  private sessionId?: string;
  private emit: ((e: Event) => void) | null = null;
  private calls = new Map<string, { server?: string }>();
  private hidden = new Set<string>();
  private activities = new Map<string, { kind: ActivityKind; detail: string }>();
  private afterTool = false;
  private stderrTail = "";
  /** What the agent advertised at initialize. */
  private loadable = false;
  private closable = false;
  /** An agent process was started at least once by this transport. */
  private spawned = false;
  /** CODEX_CONFIG the last process was started with (undefined: none set by the app). */
  private spawnedConfig: string | undefined;
  /** The engine preset hash the last process was started with (undefined: none, D0). */
  private spawnedHash: string | undefined;
  /** The turn's engine preset (hatches part 3); undefined without one (D0). */
  private engine: EnginePreset | undefined;
  /** The profile of the turn being run. */
  private profile: ModelProfile | undefined;
  /** The model the session runs, as the agent reported it at session/new or session/load (without its effort). */
  private reportedModel: string | undefined;
  /** A compaction was already reported in this turn. */
  private sawCompaction = false;
  /** config-option: what the agent offers now and the effort it runs (from session/new|load, set_config_option and config_option_update). */
  private offer: { models: string[]; efforts: string[]; effortId?: string; effort?: string } | undefined;
  /** config-option: the model the app set on the open session (undefined: OpenCode's default). */
  private appliedModel: string | undefined;
  /** The session's running cost in USD as the agent last reported it, and that total at the last turn's end (undefined: unknown). */
  private costTotal: number | undefined;
  private costBaseline: number | undefined;
  /** A cost arrived in this turn (a turn without one records no cost and keeps the baseline). */
  private costSeen = false;
  /** The adapter takes `additionalDirectories` on session/new|load (hatches spec §3.3). */
  private dirsCap = false;
  /** The turn's linked folders (hatches); empty without a scope (D0). */
  private linked: LinkedAccess[] = [];
  /** The write folders the open session was opened with, as JSON (null: no session yet). */
  private sessionDirs: string | null = null;
  /** `onLinkedUnsupported` was called already (once per process of the app). */
  private warnedLinked = false;
  /** Answers permission requests; its roots are replaced on every turn (L6). */
  private readonly policy: PermissionPolicy;

  constructor(private readonly o: TransportOptions) {
    this.policy = {
      folder: o.folder,
      permissions: o.permissions,
      readRoots: [...(o.references ?? [])],
      ...(o.mcpOnly ? { mcpOnly: true } : {}),
      mcpServers: o.mcp.map((s) => s.name),
      lookup: (id) => this.calls.get(id),
    };
  }

  /** The write folders the session is opened with: none without the capability or edit "folder" (hatches spec §3.3). */
  private writeDirs(): string[] {
    if (!this.dirsCap || this.o.permissions.edit !== "folder") return [];
    return this.linked.filter((l) => l.mode === "write").map((l) => l.path);
  }

  /** `session/new|load` params: today's, plus `additionalDirectories` only when there is one (D0). */
  private dirsParam(): { additionalDirectories?: string[] } {
    const dirs = this.writeDirs();
    return dirs.length > 0 ? { additionalDirectories: dirs } : {};
  }

  /**
   * The policy's roots for this turn's linked folders: every one is read, only write folders are edited, and only
   * when the adapter took them (without the capability the engine's sandbox can't reach them: the policy grants nothing).
   */
  private applyLinked(): void {
    const references = this.o.references ?? [];
    if (!this.dirsCap) {
      this.policy.readRoots = [...references];
      delete this.policy.writeRoots;
      return;
    }
    this.policy.readRoots = [...references, ...this.linked.map((l) => l.path)];
    const writes = this.writeDirs();
    if (writes.length > 0) this.policy.writeRoots = writes;
    else delete this.policy.writeRoots;
  }

  /**
   * The turn's write folders differ from the open session's (L6): `session/load` with the new list replaces the old
   * one (a load that fails starts a new session, as openSession does); an agent that can't load gets a new session
   * with it (Decision 9: the conversation is lost).
   */
  private async reopenWithDirs(config: string | undefined): Promise<void> {
    if (this.loadable) this.sessionId = undefined;
    else {
      await this.endSession();
      if (!this.conn) await this.connect(config);
    }
    await this.openSession();
  }


  private get byConfigOption(): boolean {
    return this.o.profileMethod === "config-option";
  }

  /** Starts the agent process and initializes the connection. */
  private async connect(config: string | undefined): Promise<void> {
    const [binary, ...args] = this.o.command;
    // CODEX_CONFIG is ours: built from the profile, replacing any inherited value (never merged).
    // Without a profile it is removed, even when `o.env` sets it: the profile is its only source.
    // The engine's fixed environment (OpenCode's permission config) goes last: nothing inherited overrides it.
    const env: NodeJS.ProcessEnv = { ...process.env, ...this.o.env, ...this.o.engineEnv };
    if (config !== undefined) env.CODEX_CONFIG = config;
    else delete env.CODEX_CONFIG;
    const child = spawn(binary, args, {
      cwd: this.o.folder,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.child = child;
    this.spawned = true;
    this.spawnedConfig = config;
    this.spawnedHash = this.engine?.hash;
    this.stderrTail = "";
    child.on("exit", () => {
      if (this.child === child) this.reset();
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    child.on("error", () => {}); // late errors (e.g. a failed kill) must not be uncaught
    child.stderr!.on("data", (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-STDERR_KEEP);
    });

    const policy = this.policy;
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    );
    this.conn = acp
      .client({ name: "humanharness" })
      .onRequest("session/request_permission", (ctx) => decidePermission(ctx.params as PermissionRequest, policy) as never)
      .onNotification("session/update", (ctx) => this.onUpdate(ctx.params.update as Record<string, any>, ctx.params.sessionId))
      .connect(stream);

    const init = await this.conn.agent.request("initialize", {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const version = (init as { agentInfo?: { version?: string } | null }).agentInfo?.version;
    if (this.o.minAdapterVersion && version && versionLess(version, this.o.minAdapterVersion)) {
      throw new OutdatedAdapterError(`ACP adapter ${version} is older than required ${this.o.minAdapterVersion}`);
    }
    this.loadable = Boolean(init.agentCapabilities?.loadSession);
    this.closable = Boolean(init.agentCapabilities?.sessionCapabilities?.close);
    this.dirsCap = Boolean(init.agentCapabilities?.sessionCapabilities?.additionalDirectories);
  }

  /** The core's servers, then the turn's preset servers (hatches spec §5.2); the core's alone without a preset (D0). */
  private mcpServers() {
    return [...this.o.mcp, ...(this.engine?.servers ?? [])].map((s) => ({
      name: s.name,
      command: s.command,
      args: s.args,
      env: Object.entries(s.env).map(([name, value]) => ({ name, value })),
    }));
  }

  /** Loads the saved session (when there is one and the agent can) or creates a new one, then sets its mode. */
  private async openSession(): Promise<void> {
    this.offer = undefined;
    this.appliedModel = undefined;
    // A loaded session's total so far is unknown (OpenCode sends no usage_update on session/load):
    // its first turn only sets the baseline. A new session starts from zero.
    this.costTotal = undefined;
    this.costBaseline = undefined;
    const agent = this.conn!.agent;
    const mcpServers = this.mcpServers();
    if (this.o.session.started && this.loadable) {
      let loaded: { configOptions?: unknown; models?: { currentModelId?: unknown } | null } | undefined;
      try {
        loaded = (await agent.request("session/load", { sessionId: this.o.session.id, cwd: this.o.folder, mcpServers, ...this.dirsParam() })) as typeof loaded;
        this.sessionId = this.o.session.id;
      } catch (e) {
        // An expired login must surface; any other load failure (lost session) falls back to a fresh one.
        const event = errorFrom(e);
        if (event.type === "done" && !event.ok && event.error?.code === "session-expired") throw e;
      }
      if (this.sessionId) {
        this.costBaseline = this.costTotal;
        this.reportModels(loaded?.configOptions);
        this.sessionModel(loaded?.configOptions, loaded?.models?.currentModelId);
      }
    }
    if (!this.sessionId) {
      const created = (await agent.request("session/new", { cwd: this.o.folder, mcpServers, ...this.dirsParam() })) as {
        sessionId: string;
        configOptions?: unknown;
        models?: { currentModelId?: unknown } | null;
      };
      this.sessionId = created.sessionId;
      this.costBaseline = 0;
      this.reportModels(created.configOptions);
      this.sessionModel(created.configOptions, created.models?.currentModelId);
      this.o.session = { id: created.sessionId, started: true };
      this.o.onSessionStarted(this.o.session);
    }
    this.sessionDirs = JSON.stringify(this.writeDirs());
    if (this.o.sessionMode) {
      await agent.request("session/set_mode", { sessionId: this.sessionId, modeId: this.o.sessionMode });
    }
  }

  private reportModels(configOptions: unknown): void {
    if (this.byConfigOption && Array.isArray(configOptions)) {
      const offered = offeredModels(configOptions);
      const effortId = effortOptionId(configOptions);
      const effort = effortId ? currentValue(configOptions, effortId) : undefined;
      this.offer = {
        // Every offered id, not the 50 Settings shows: a profile's model past the 50th is still offered.
        models: offered ? offeredModelIds(configOptions) : [],
        efforts: offered?.efforts ?? [],
        ...(effortId ? { effortId } : {}),
        ...(effort !== undefined ? { effort } : {}),
      };
      const model = currentValue(configOptions, "model");
      if (isModelId(model)) this.reportedModel = model;
    }
    const offer = offeredModels(configOptions);
    if (!offer) return;
    try {
      this.o.onModels?.(offer);
    } catch (err) {
      console.error("Could not record the engine's models", err);
    }
  }

  /** The model the new session runs: Codex's is checked against the profile; OpenCode's is set afterwards (applyProfile). */
  private sessionModel(configOptions: unknown, currentModelId: unknown): void {
    if (!this.byConfigOption) return this.checkModel(currentModelId);
    const model = Array.isArray(configOptions) ? currentValue(configOptions, "model") : undefined;
    this.reportedModel = isModelId(model) ? model : undefined;
  }

  /**
   * OpenCode (spec §3): sets the profile's model, then its effort, on the open session; only what differs.
   * The cap is not sent: OpenCode compacts on its own. A refused value (-32602) is model-unavailable.
   */
  private async applyProfile(): Promise<void> {
    const p = this.profile;
    if (!this.byConfigOption || !p) return;
    const agent = this.conn!.agent;
    const sessionId = this.sessionId!;
    const set = async (configId: string, value: string) => {
      try {
        const res = (await agent.request("session/set_config_option", { sessionId, configId, value } as never)) as { configOptions?: unknown } | null;
        if (res?.configOptions) this.reportModels(res.configOptions);
      } catch (e) {
        // Only an invalid params error about the value itself: a lost session is -32602 too.
        if (e instanceof acp.RequestError && e.code === -32602 && namesConfigValue(e.data)) {
          throw new ModelUnavailableError(`The agent refused ${configId} ${value}: ${e.message}`);
        }
        throw e;
      }
    };
    // Checked on every turn: a config_option_update may have removed the model since it was set.
    // An offer without models (an agent that sends no model select) says nothing: the agent answers the set itself.
    const offered = this.offer?.models ?? [];
    if (p.model !== undefined && (!isModelId(p.model) || (offered.length > 0 && !offered.includes(p.model)))) {
      throw new ModelUnavailableError(`The agent does not offer ${String(p.model)}`);
    }
    if (p.model !== undefined && p.model !== this.appliedModel) {
      await set("model", p.model);
      this.appliedModel = p.model;
      this.reportedModel = p.model;
    }
    // Read after the model: OpenCode offers an effort only for a model with variants. An effort it does not
    // offer is not sent: the session keeps the effort it runs (the model's default, or one set earlier).
    const offer = this.offer;
    if (offer?.effortId && offer.efforts.includes(p.effort) && offer.effort !== p.effort) {
      await set(offer.effortId, p.effort);
      if (this.offer) this.offer.effort = p.effort;
    }
  }

  /** Codex says which model the session runs: another one than the profile asked for means the plan lacks it (spec §5.3). */
  private checkModel(current: unknown): void {
    this.reportedModel = typeof current === "string" ? current.replace(/\[[^\]]*\]$/, "") : undefined;
    const wanted = this.profile?.model;
    // An agent that reports no model is accepted: the model it runs is then unknown, not wrong.
    if (wanted !== undefined && this.reportedModel !== undefined && this.reportedModel !== wanted) {
      throw new ModelUnavailableError(`Asked for ${wanted}; the agent runs ${String(current)}`);
    }
  }

  private compacted(emit: (e: Event) => void): void {
    if (this.sawCompaction) return;
    this.sawCompaction = true;
    emit({ type: "compaction" });
  }

  /** This turn's cost: the rise of the running total since the last turn; undefined when either end is unknown. */
  private turnCost(): number | undefined {
    const total = this.costTotal;
    if (!this.costSeen || total === undefined) return undefined;
    const base = this.costBaseline;
    this.costBaseline = total;
    return base === undefined ? undefined : Math.max(0, total - base);
  }

  private reset(): void {
    this.conn = undefined;
    this.costTotal = undefined;
    this.costBaseline = undefined;
    this.reportedModel = undefined;
    this.offer = undefined;
    this.appliedModel = undefined;
    this.child = undefined;
    this.sessionId = undefined;
    this.sessionDirs = null;
    this.calls.clear();
    this.hidden.clear();
    this.activities.clear();
  }

  private signalGroup(child: ChildProcess, sig: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      try {
        child.kill(sig);
      } catch {}
    }
  }

  /** SIGTERM the process group, SIGKILL after a delay; resolves when the child has exited. */
  private async terminate(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.signalGroup(child, "SIGKILL"), KILL_MS);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.signalGroup(child, "SIGTERM");
    });
  }

  private onUpdate(u: Record<string, any>, sessionId?: unknown): void {
    // The offer changes with or without a turn running (OpenCode sends it when the model or the provider's models change).
    if (u.sessionUpdate === "config_option_update") {
      if (this.byConfigOption) this.reportModels(u.configOptions);
      return;
    }
    // Only an engine whose profile goes by config option (OpenCode) reports cost; Codex's is never read (D0).
    // A cost of another session (one closed or loaded before) is not this session's running total.
    if (u.sessionUpdate === "usage_update" && this.byConfigOption && sessionId === this.sessionId) {
      const usd = usdCost(u.cost);
      if (usd !== undefined) {
        this.costTotal = usd;
        this.costSeen = true;
      }
    }
    const emit = this.emit;
    if (!emit) return;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content?.type !== "text" || !u.content.text) return;
        if (this.afterTool) {
          emit({ type: "paragraph" });
          this.afterTool = false;
        }
        emit({ type: "text", delta: u.content.text });
        return;
      case "tool_call": {
        if (u.title === COMPACT_TITLE) {
          this.hidden.add(u.toolCallId);
          this.compacted(emit);
          return;
        }
        // Only Codex's own MCP marker is trusted for the server; rawInput is model-written.
        const server = u._meta?.is_mcp_tool_call === true ? serverOf(u.rawInput) : undefined;
        this.calls.set(u.toolCallId, { server });
        if (u.kind === "think" || server === "ui") {
          this.hidden.add(u.toolCallId);
          return;
        }
        const activity = { kind: typeof u.kind === "string" && Object.hasOwn(KINDS, u.kind) ? KINDS[u.kind] : ("other" as const), detail: activityDetail(u) };
        this.activities.set(u.toolCallId, activity);
        this.afterTool = true;
        const edits = acpEditPaths(u);
        emit({ type: "activity", id: u.toolCallId, ...activity, ...acpExtras(u, server), ...(edits.length > 0 ? { edits } : {}), state: "start" });
        return;
      }
      case "tool_call_update": {
        if (this.hidden.has(u.toolCallId)) return;
        const activity = this.activities.get(u.toolCallId);
        if (!activity || (u.status !== "completed" && u.status !== "failed")) return;
        this.activities.delete(u.toolCallId);
        emit({ type: "activity", id: u.toolCallId, ...activity, state: "end", error: u.status === "failed" });
        return;
      }
      case "usage_update":
        // One context event per update: consumers keep the last one.
        if (typeof u.used === "number" && Number.isFinite(u.used)) {
          emit({ type: "context", used: u.used, ...(typeof u.size === "number" ? { size: u.size } : {}) });
        }
        return;
      case "compaction_update":
        this.compacted(emit);
        return;
    }
  }

  async turn(message: string, emit: (e: Event) => void, signal: AbortSignal, profile?: ModelProfile, scope?: TurnScope): Promise<void> {
    let config: string | undefined;
    const engine = scope?.engine;
    try {
      if (engine) checkPreset(engine, this.o);
      // Codex only: the preset's codex.toml joins CODEX_CONFIG (OpenCode gets the servers alone). Empty: as without one.
      const codex = engine?.codex && Object.keys(engine.codex).length > 0 ? engine.codex : undefined;
      if (!this.byConfigOption) config = profile ? codexConfig(profile, codex) : codex ? JSON.stringify(mergeCodex({}, codex)) : undefined;
    } catch (err) {
      // No ErrorCode fits a profile or a preset the core built wrong (it is not the plan's model, nor the user's
      // quota): agent-crashed is the generic "this turn could not run" card. The shell cleans every profile and
      // preset first, so this is a last guard that should never show.
      emit(fail("agent-crashed", err instanceof Error ? err.message : String(err)));
      return;
    }
    // CODEX_CONFIG is read when the agent starts: a task on another profile needs a new process,
    // and a fresh session, so a saved one never resumes under another model (spec D2).
    // An engine preset's servers are set at session/new: another hash (or none) needs a new process and session too.
    if (this.spawned && (config !== this.spawnedConfig || engine?.hash !== this.spawnedHash)) {
      await this.close();
      this.o.session = { id: randomUUID(), started: false };
    }
    // config-option: a session can't go back to the default model, so a profile without one starts afresh (D2).
    if (this.byConfigOption && this.appliedModel !== undefined && profile?.model === undefined) {
      await this.close();
      this.o.session = { id: randomUUID(), started: false };
    }
    this.profile = profile;
    this.calls.clear();
    this.hidden.clear();
    this.activities.clear();
    // Built per turn from the task's scope (L5, L6): an unlinked folder is gone from this turn on.
    this.linked = scope?.linked ?? [];
    this.engine = engine;
    // The approved preset's servers are trusted as the core's for this turn only (the person approved them); D0: the core's.
    this.policy.mcpServers = [...this.o.mcp, ...(engine?.servers ?? [])].map((s) => s.name);
    try {
      if (!this.conn || !this.sessionId) {
        if (!this.conn) await this.connect(config);
        await this.openSession();
      } else if (JSON.stringify(this.writeDirs()) !== this.sessionDirs) {
        await this.reopenWithDirs(config);
      }
      this.applyLinked();
      if (this.linked.length > 0 && !this.dirsCap && !this.warnedLinked) {
        this.warnedLinked = true;
        try {
          this.o.onLinkedUnsupported?.();
        } catch (err) {
          console.error("Could not report the adapter's missing linked folders", err);
        }
      }
      await this.applyProfile();
    } catch (e) {
      const event = errorFrom(e, this.stderrTail);
      await this.close();
      emit(event);
      return;
    }
    if (signal.aborted) {
      emit(fail("cancelled"));
      return;
    }
    const agent = this.conn!.agent;
    const child = this.child!;
    const sessionId = this.sessionId!;
    this.emit = emit;
    this.afterTool = false;
    this.sawCompaction = false;
    this.costSeen = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      void agent.notify("session/cancel", { sessionId });
      // An agent that ignores the cancel must not hang the turn.
      grace ??= setTimeout(() => void this.terminate(child), GRACE_MS);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    let expired = false;
    try {
      const pending = agent.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: message }],
      });
      // The signal may have fired while the prompt was being sent.
      if (signal.aborted) onAbort();
      const res = (await pending) as { stopReason: string; usage?: AcpUsage | null };
      // Only OpenCode reports cost (Codex's turn is unchanged, D0). The cost is taken here, where it is always
      // emitted: a response without token usage still carries it (spec A8), so the baseline never moves silently.
      const costUsd = this.byConfigOption ? this.turnCost() : undefined;
      if (res.usage || costUsd !== undefined) {
        emit({
          type: "usage",
          inputTokens: res.usage?.inputTokens ?? 0,
          outputTokens: res.usage?.outputTokens ?? 0,
          cacheReadTokens: res.usage?.cachedReadTokens ?? 0,
          cacheWriteTokens: res.usage?.cachedWriteTokens ?? 0,
          ...(this.reportedModel ? { model: this.reportedModel } : {}),
          ...(costUsd !== undefined ? { costUsd } : {}),
        });
      }
      if (res.stopReason === "cancelled" || signal.aborted) emit(fail("cancelled"));
      else if (res.stopReason === "refusal") emit(fail("agent-crashed", "refusal"));
      else emit({ type: "done", ok: true });
    } catch (e) {
      if (signal.aborted) emit(fail("cancelled"));
      else {
        const event = errorFrom(e, this.stderrTail);
        expired = event.type === "done" && !event.ok && event.error?.code === "session-expired";
        emit(event);
      }
    } finally {
      clearTimeout(grace);
      signal.removeEventListener("abort", onAbort);
      this.emit = null;
    }
    // Close after an expired login so the next turn starts a fresh process that sees a new login.
    if (expired) await this.close();
  }

  /** How long `endSession` waits for `session/close` before giving up on the process. */
  sessionCloseTimeoutMs = 3000;

  /**
   * Closes the session with `session/close` and keeps the process for the next one. When the agent
   * does not offer `session/close`, or does not answer it in time, the process is closed instead and
   * the next turn reconnects.
   */
  async endSession(): Promise<void> {
    const sessionId = this.sessionId;
    this.sessionId = undefined;
    // The next session starts on the default model: a profile without one must not restart the process.
    this.appliedModel = undefined;
    this.o.session = { id: randomUUID(), started: false };
    if (!sessionId || !this.conn) return;
    if (!this.closable) {
      await this.close();
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.sessionCloseTimeoutMs);
    });
    const closed = this.conn.agent.request("session/close", { sessionId }).then(
      () => "closed" as const,
      () => "closed" as const, // the next turn opens a new session anyway
    );
    const outcome = await Promise.race([closed, timedOut]);
    clearTimeout(timer);
    if (outcome === "timeout") await this.close();
  }

  async close(): Promise<void> {
    const child = this.child;
    this.conn?.close();
    this.reset();
    if (child) await this.terminate(child);
  }
}
