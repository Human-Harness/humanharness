import type { McpServerSpec } from "@humanharness/blocks";
import type { EnginePreset } from "@humanharness/runtime";
import { type EngineApproval, type ScopeEntry, engineConfigDir, isScopeId } from "@humanharness/workspace";
import { engineApprovalValid, enginePinTag, enginePinValid } from "./approval";
import type { CleanSettings } from "./clean";
import { type EngineConfig, type ReadEngineOptions, readEngineConfig } from "./read-config";
import { type EngineSnapshot, loadSnapshot, pinnedScriptsUnchanged, writeSnapshot } from "./snapshot";

// Which engine preset a task gets (hatches spec §5.2, §5.3, E1, Decision 2). A new task gets its scope's config only
// when the person approved exactly what the engine folder holds now (the app's signed approval, the hash computed
// right then, no refusal with today's context); the snapshot is written then and the task keeps its hash. Every later
// turn checks the live folder again: hook and server scripts run where they are, so an edit after the approval
// (one the person didn't approve again) drops the preset from that turn on, with a notice. Without an engine folder,
// or an empty one, nothing happens at all (D0 for the scope).

/** Why a task runs without its scope's engine config: never approved, changed since, or refused. Null: no notice. */
export type EngineNotice = "unapproved" | "refused" | null;

/** What a task gets from its scope's engine config. */
export interface TaskPreset {
  preset: EnginePreset | null;
  /** The first message's "Scope instructions" section; "" for none. */
  instructions: string;
  notice: EngineNotice;
  /** The approved hash the task keeps (Decision 2); absent without a preset. */
  hash?: string;
}

interface EngineHostDeps {
  /** The app's data folder: snapshots live in `<userData>/engine-config/`. */
  userData: string;
  /** The open base (the folder, or the profile's), its profile id ("" without profiles) and its scope registry; null when not set up. */
  context(): Promise<{ base: string; profile: string; scopes: { list(): Promise<ScopeEntry[]> } } | null>;
  /** The scope's usable linked folders, absolute (what a turn reaches). */
  linked(scope: string): Promise<string[]>;
  /** The app's approval key (`linkedSecret(userData)(false)`); null when there is none yet. */
  secret(): Promise<Buffer | null>;
  /** The scope's approval epoch (`EngineEpochs.get`, bumped by a revoke); null when the record is damaged. */
  epoch(profile: string, scope: string): Promise<number | null>;
  /** The manifest's permissions, actions and MCP servers (cleaning context, reserved names). */
  harness: { permissions: { edit: "folder" | "none"; web: boolean }; actions: Readonly<Record<string, unknown>>; mcp: readonly string[] };
  log?(message: string, err?: unknown): void;
}

/** Core server names a preset server may never take (E9), with the harness's own. */
const CORE_SERVERS = ["ui", "data", "translate", "review"];
const NONE: TaskPreset = { preset: null, instructions: "", notice: null };
const SECTION = "## Scope instructions";

/** Server lists by name; a later one replaces an earlier one of the same name (an action layer's wins). */
function mergeServers(...lists: McpServerSpec[][]): McpServerSpec[] {
  const out = new Map<string, McpServerSpec>();
  for (const s of lists.flat()) out.set(s.name, s);
  return [...out.values()];
}

/**
 * The scope's settings with an action layer's on top: a hook event the layer sets replaces the scope's; permission
 * lists are joined (a deny is never lost). Undefined when neither has any.
 */
function mergeSettings(scope: CleanSettings | null | undefined, layer: CleanSettings | null | undefined): CleanSettings | undefined {
  if (!scope && !layer) return undefined;
  const out: CleanSettings = {};
  const hooks = { ...scope?.hooks, ...layer?.hooks };
  if (Object.keys(hooks).length > 0) out.hooks = hooks;
  const permissions: NonNullable<CleanSettings["permissions"]> = {};
  for (const k of ["allow", "deny", "ask"] as const) {
    const list = [...new Set([...(scope?.permissions?.[k] ?? []), ...(layer?.permissions?.[k] ?? [])])];
    if (list.length > 0) permissions[k] = list;
  }
  if (Object.keys(permissions).length > 0) out.permissions = permissions;
  return Object.keys(out).length > 0 ? out : undefined;
}

/** The first message's section: the scope's instructions, then the action layer's. "" when both are empty. */
function section(snap: EngineSnapshot, action: string | undefined): string {
  const layer = action !== undefined && Object.hasOwn(snap.actions, action) ? snap.actions[action] : undefined;
  const parts = [snap.instructions.trim(), layer?.instructions.trim() ?? ""].filter(Boolean);
  return parts.length > 0 ? `${SECTION}\n\n${parts.join("\n\n")}` : "";
}

/** The snapshot as the engines get it, with the task's action layer on top. */
function presetOf(snap: EngineSnapshot, action: string | undefined): EnginePreset {
  const layer = action !== undefined && Object.hasOwn(snap.actions, action) ? snap.actions[action] : undefined;
  const settings = mergeSettings(snap.settings, layer?.settings);
  return {
    hash: snap.hash,
    base: snap.base,
    ...(settings ? { settings } : {}),
    servers: mergeServers(snap.servers, layer?.servers ?? []),
    ...(snap.pluginDir ? { pluginDir: snap.pluginDir } : {}),
    ...(snap.agentsFile ? { agentsFile: snap.agentsFile } : {}),
    ...(snap.codex ? { codex: snap.codex } : {}),
  };
}

export class EngineHost {
  constructor(private readonly d: EngineHostDeps) {}

  /** The cleaning context of `scope` today, and its live engine folder. */
  private async options(base: string, scope: string): Promise<ReadEngineOptions & { dir: string }> {
    const h = this.d.harness;
    return {
      folder: base,
      linked: await this.d.linked(scope),
      edit: h.permissions.edit,
      reserved: new Set([...CORE_SERVERS, ...h.mcp]),
      actions: h.actions,
      web: h.permissions.web,
      dir: engineConfigDir(base, scope),
    };
  }

  /**
   * What the live engine folder of `scope` hashes to now and whether the person approved exactly that: null when the
   * scope has no engine config (D0 for it, nothing else is read). Writes the snapshot only for a valid approval.
   */
  private async live(scope: string) {
    if (!isScopeId(scope)) return null;
    const ctx = await this.d.context();
    if (!ctx) return null;
    const o = await this.options(ctx.base, scope);
    const config = await readEngineConfig(o.dir, o);
    if (!config) return null;
    const entry = (await ctx.scopes.list()).find((s) => s.id === scope && !s.archived);
    const approval = entry?.engineApproval;
    // Signed by the app at the scope's epoch now: one from before a revoke (pasted back) no longer holds.
    const signed = approval ? engineApprovalValid(approval, ctx.profile, scope, await this.d.secret(), await this.d.epoch(ctx.profile, scope)) : false;
    return { config, o, approvedHash: signed ? approval!.hash : null, approval: signed ? approval! : null };
  }

  /**
   * What the scope settings' Engine config shows (spec §5.3): the live folder's config and the approval the app
   * signed (none when the tag isn't the app's). Null when the scope has no engine config (D0 for it).
   */
  async current(scope: string): Promise<{ config: EngineConfig; approval: EngineApproval | null } | null> {
    const now = await this.live(scope);
    return now && { config: now.config, approval: now.approval };
  }

  /** The snapshot of `hash` for `scope`, derived again with today's context; null (logged) when it can't be used. */
  private async load(hash: string, scope: string, o: ReadEngineOptions & { dir: string }): Promise<EngineSnapshot | "refused" | null> {
    try {
      const snap = await loadSnapshot(this.d.userData, hash, scope, o);
      return snap.refusals.length > 0 ? "refused" : snap;
    } catch (err) {
      this.log(`Could not load the approved engine config of scope ${scope}`, err);
      return null;
    }
  }

  /** For a new task in `scope` (with `action`'s layer): the approved, unchanged config, or none and why. */
  async presetFor(scope: string, action: string | undefined): Promise<TaskPreset> {
    const now = await this.live(scope);
    if (!now) return NONE;
    const { config, o, approvedHash } = now;
    if (config.refusals.length > 0) return { ...NONE, notice: "refused" };
    // E1: only exactly what was approved, by the app's own signature.
    if (approvedHash !== config.hash) return { ...NONE, notice: "unapproved" };
    try {
      await writeSnapshot(this.d.userData, config, scope);
    } catch (err) {
      this.log(`Could not save the approved engine config of scope ${scope}`, err);
      return { ...NONE, notice: "unapproved" };
    }
    const snap = await this.load(config.hash, scope, o);
    if (snap === "refused") return { ...NONE, notice: "refused" };
    if (!snap) return { ...NONE, notice: "unapproved" };
    return { preset: presetOf(snap, action), instructions: section(snap, action), notice: null, hash: snap.hash };
  }

  /** The tag a new task `task` stores with its pin to `hash` in `scope` (`engineTag`); null without a key or a setup. */
  async pinTag(scope: string, task: string, hash: string): Promise<string | null> {
    const ctx = await this.d.context();
    const secret = await this.d.secret();
    const epoch = ctx ? await this.d.epoch(ctx.profile, scope) : null;
    return ctx && secret && epoch !== null ? enginePinTag(ctx.profile, scope, task, hash, secret, epoch) : null;
  }

  /**
   * For a later turn (or a resumed session) of a task that started with `engineHash`: its pinned snapshot (Decision 2).
   * Only while the scope has an approval the app signed (clearing it stops running tasks too), the pin carries the
   * app's tag at the scope's epoch (tasks.json is agent-writable; a revoke ends every pin made before it), and the live folder holds approved bytes. Pinned to the approved hash:
   * the folder must hash to it. Pinned to an older one: the folder must hold either hash, and every file the pinned
   * commands run must still be the pinned bytes (scripts run in place; one only the pin runs is in no live approval).
   * Otherwise none and a notice. A task that started without a preset stays without one.
   */
  async presetForTask(task: { id?: string; scope?: string; action?: string; engineHash?: string; engineTag?: string }): Promise<TaskPreset> {
    if (task.engineHash === undefined || task.scope === undefined) return NONE;
    const unapproved: TaskPreset = { ...NONE, notice: "unapproved" };
    const now = await this.live(task.scope);
    if (!now) return unapproved;
    const { config, o, approvedHash } = now;
    if (config.refusals.length > 0) return { ...NONE, notice: "refused" };
    if (approvedHash === null) return unapproved;
    // The pin always needs the app's tag: a task that started without a preset can't gain one by writing the
    // approved hash into tasks.json.
    const ctx = await this.d.context();
    const secret = await this.d.secret();
    const epoch = ctx ? await this.d.epoch(ctx.profile, task.scope) : null;
    if (!ctx || task.id === undefined || !enginePinValid(task.engineTag, ctx.profile, task.scope, task.id, task.engineHash, secret, epoch)) return unapproved;
    if (approvedHash === task.engineHash) {
      if (config.hash !== task.engineHash) return unapproved;
    } else {
      if (config.hash !== task.engineHash && config.hash !== approvedHash) return unapproved;
      if (!(await pinnedScriptsUnchanged(this.d.userData, task.engineHash, o))) return unapproved;
    }
    const snap = await this.load(task.engineHash, task.scope, o);
    if (snap === "refused") return { ...NONE, notice: "refused" };
    if (!snap) return { ...NONE, notice: "unapproved" };
    return { preset: presetOf(snap, task.action), instructions: section(snap, task.action), notice: null, hash: snap.hash };
  }

  private log(message: string, err?: unknown): void {
    (this.d.log ?? console.error)(message, err);
  }
}
