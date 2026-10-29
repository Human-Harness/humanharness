import { PLUGIN_ID, PLUGIN_LOCAL_ID, SETTING_NAME } from "@humanharness/harness-sdk";
import type {
  AttentionTarget,
  AttentionView,
  PanelAnswer,
  PanelCall,
  PluginDetail,
  PluginPick,
  PluginResult,
  PluginSurfaceView,
  PluginsView,
  PluginTestResult,
} from "@humanharness/ui/client";
import type { PluginBackendHost } from "./plugin-host";
import type { PluginsController, PreparedStart } from "./plugins";
import { ScopeRequired } from "./task-manager";

/**
 * Settings › Plugins and the Attention inbox over IPC (plugins spec §6, §7). Registered only when the harness takes
 * plugins (D0: no handler otherwise), through index.ts's handle(), which answers only the app's page (B5).
 *
 * Every argument is checked and bounded here before the controller sees it; a malformed request answers
 * "Invalid request" (or null / [] for reads) and calls nothing. The renderer never sends a path (Add takes a pick's
 * token, Decision 18) and never gets a key's value back (B6). A controller that rejects answers a refusal, never a
 * thrown error (Electron would carry its message, which may name a path, to the page).
 */

export const PLUGIN_IPC_CHANNELS = [
  "hh:pluginsGet",
  "hh:pluginsRescan",
  "hh:pluginsSetOn",
  "hh:pluginsPick",
  "hh:pluginsAdd",
  "hh:pluginsApprove",
  "hh:pluginsRemove",
  "hh:pluginsDetail",
  "hh:pluginsSetSetting",
  "hh:pluginsResetSettings",
  "hh:pluginsSetWorkHours",
  "hh:pluginsSetSecret",
  "hh:pluginsDeleteSecret",
  "hh:pluginsSetNotify",
  "hh:pluginsTest",
  "hh:pluginsRefresh",
  "hh:attentionGet",
  "hh:attentionDismiss",
  "hh:attentionRead",
  "hh:pluginsSurface",
  "hh:pluginsPanel",
  "hh:pluginsStartPrepared",
  "hh:pluginsCancelPrepared",
  "hh:attentionOpen",
] as const;

type Handle = (channel: string, fn: (...args: never[]) => unknown) => void;
type Ctl = Pick<
  PluginsController,
  | "view"
  | "rescan"
  | "setOn"
  | "pick"
  | "add"
  | "approve"
  | "remove"
  | "detail"
  | "setSetting"
  | "resetSettings"
  | "setWorkHours"
  | "setSecret"
  | "deleteSecret"
  | "setNotify"
  | "test"
  | "refresh"
  | "surface"
  | "panelCall"
  | "takePrepared"
  | "cancelPrepared"
> & { attention: Pick<PluginsController["attention"], "view" | "dismiss" | "read" | "open"> };

/** What a prepared task's Start needs from the app (plugins spec §5.3, P6). */
export interface PreparedDeps {
  /** TaskManager.startPrepared, given exactly what the controller's token held. */
  startPrepared: (p: PreparedStart) => Promise<void>;
  /** Why no task may start now (the app closing, a turn running or held), or null. Asked before the token is used. */
  startBlocked?(): string | null;
  /** A harness with scopes: its label and whether one is open. Absent: no scopes, so no card waits for one. */
  scopes?: { label: string; open(): Promise<boolean> };
}

const INVALID: PluginResult = { ok: false, message: "Invalid request" };
const FAILED_MESSAGE = "Something went wrong";
const FAILED: PluginResult = { ok: false, message: FAILED_MESSAGE };
/** A pick's token (PluginsController.pick: 16 random bytes in hex). */
const TOKEN = /^[0-9a-f]{32}$/;
/** A dist hash (sha256 hex): what the review showed, sent back by Approve. */
const HASH = /^[0-9a-f]{64}$/;
/** An attention item's key (the broker's and the scheduler's keys, e.g. `sync-failing:<source>`). */
const ATTENTION_KEY = /^[A-Za-z0-9:._-]{1,80}$/;
/** The calls a panel makes through main (Decision 7); `resize` stays in the window. */
const PANEL_CALLS: readonly PanelCall[] = ["data.query", "settings.get", "refresh", "requestAction"];
/** A panel call's args as JSON; the controller bounds each call's own args again (4 KB). */
const PANEL_ARGS_MAX = 16 * 1024;
const PANEL_INVALID: PanelAnswer = { ok: false, error: "Invalid request" };
const EMPTY_SURFACE: PluginSurfaceView = { panels: [], chips: [], reloads: {} };
const NOT_PREPARED: PluginResult = { ok: false, message: "This task is no longer prepared" };
/** A setting value's JSON and a key's value (Decision 17). */
const SETTING_JSON_MAX = 8 * 1024;
const SECRET_CHARS_MAX = 8192;
/** Refresh and Test (B11): one at a time per source (per plugin for a Test), at most REFRESH_PER_MINUTE together from the window. */
const REFRESH_PER_MINUTE = 5;
const MINUTE = 60_000;
const REFRESH_SAID = { busy: "A refresh of this source is already running", tooMany: "Too many refreshes; try again in a minute" };
const TEST_SAID = { busy: "A test of this plugin is already running", tooMany: "Too many tests; try again in a minute" };

const isId = (v: unknown): v is string => typeof v === "string" && PLUGIN_ID.test(v);
const isLocalId = (v: unknown): v is string => typeof v === "string" && PLUGIN_LOCAL_ID.test(v);

/** A setting value small enough to check: its JSON at most SETTING_JSON_MAX characters. */
function smallValue(v: unknown): boolean {
  if (v === undefined) return true;
  try {
    const json = JSON.stringify(v);
    return json === undefined || json.length <= SETTING_JSON_MAX;
  } catch {
    return false;
  }
}

/** A panel call's args: absent, or JSON of at most PANEL_ARGS_MAX characters (no cycles, no BigInt). */
function panelArgs(v: unknown): boolean {
  if (v === undefined) return true;
  try {
    const json = JSON.stringify(v);
    return json !== undefined && json.length <= PANEL_ARGS_MAX;
  } catch {
    return false;
  }
}

/** The work hours' own fields, bounded; the controller checks what they mean (days, HH:MM, a known time zone). */
function workHoursInput(v: unknown): { days: number[]; from: string; to: string; timezone: string } | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const { days, from, to, timezone } = v as Record<string, unknown>;
  if (!Array.isArray(days) || days.length > 7 || !days.every((d) => Number.isInteger(d))) return null;
  const short = (s: unknown, max: number): s is string => typeof s === "string" && s.length <= max;
  if (!short(from, 5) || !short(to, 5) || !short(timezone, 64)) return null;
  return { days: [...(days as number[])], from, to, timezone };
}

/** A result as plain data: `ok`, a message, or a review; nothing else the controller may have added crosses. */
function result(r: PluginResult): PluginResult {
  if (r.ok) return { ok: true };
  if ("review" in r) return { ok: false, review: r.review, ...(typeof r.message === "string" ? { message: r.message } : {}) };
  return { ok: false, message: typeof r.message === "string" ? r.message : FAILED_MESSAGE };
}

export function registerPluginsIpc(handle: Handle, ctl: Ctl, o: PreparedDeps & { now?: () => number; log?: (message: string, err?: unknown) => void }): void {
  const now = o.now ?? Date.now;
  const log = o.log ?? ((m: string, err?: unknown) => console.error(`[plugins] ${m}`, err ?? ""));
  const refused = (what: string) => (err: unknown) => {
    log(`${what} failed`, err);
    return FAILED;
  };
  const act = (what: string, run: () => Promise<PluginResult>): Promise<PluginResult> => run().then(result, refused(what));
  const read = <T>(what: string, run: () => Promise<T>, empty: T): Promise<T> =>
    run().catch((err: unknown) => {
      log(`${what} failed`, err);
      return empty;
    });

  handle("hh:pluginsGet", (): Promise<PluginsView | null> => read("Reading the plugins", () => ctl.view(), null));
  handle("hh:pluginsRescan", (): Promise<PluginsView | null> => read("Rescanning the plugins", () => ctl.rescan(), null));
  handle("hh:pluginsSetOn", (id: unknown, on: unknown) => (isId(id) && typeof on === "boolean" ? act("Turning a plugin on or off", () => ctl.setOn(id, on)) : INVALID));
  // Main shows the folder dialog; the answer is a review and a token, never the folder's path from the page.
  handle("hh:pluginsPick", (): Promise<PluginPick> =>
    ctl.pick().catch((err: unknown) => {
      log("Choosing a plugin folder failed", err);
      return { ok: false, message: FAILED_MESSAGE };
    }),
  );
  handle("hh:pluginsAdd", (token: unknown) => (typeof token === "string" && TOKEN.test(token) ? act("Adding a plugin", () => ctl.add(token)) : INVALID));
  handle("hh:pluginsApprove", (id: unknown, distHash: unknown) =>
    isId(id) && typeof distHash === "string" && HASH.test(distHash) ? act("Approving a plugin", () => ctl.approve(id, distHash)) : INVALID,
  );
  handle("hh:pluginsRemove", (id: unknown) => (isId(id) ? act("Removing a plugin", () => ctl.remove(id)) : INVALID));
  // The controller keeps key values out of the detail (B6): only which keys are stored.
  handle("hh:pluginsDetail", async (id: unknown): Promise<PluginDetail | null> => (isId(id) ? read("Reading a plugin's detail", () => ctl.detail(id), null) : null));
  handle("hh:pluginsSetSetting", (id: unknown, field: unknown, value: unknown) =>
    isId(id) && typeof field === "string" && SETTING_NAME.test(field) && smallValue(value) ? act("Saving a plugin setting", () => ctl.setSetting(id, field, value)) : INVALID,
  );
  handle("hh:pluginsResetSettings", (id: unknown) => (isId(id) ? act("Resetting a plugin's settings", () => ctl.resetSettings(id)) : INVALID));
  handle("hh:pluginsSetWorkHours", (id: unknown, wh: unknown) => {
    const input = workHoursInput(wh);
    return isId(id) && input ? act("Saving a plugin's work hours", () => ctl.setWorkHours(id, input)) : INVALID;
  });
  // B6: the value goes in, and only `ok` or a message comes back.
  handle("hh:pluginsSetSecret", (id: unknown, secret: unknown, value: unknown) =>
    isId(id) && isLocalId(secret) && typeof value === "string" && value.length <= SECRET_CHARS_MAX ? act("Storing a plugin key", () => ctl.setSecret(id, secret, value)) : INVALID,
  );
  handle("hh:pluginsDeleteSecret", (id: unknown, secret: unknown) => (isId(id) && isLocalId(secret) ? act("Deleting a plugin key", () => ctl.deleteSecret(id, secret)) : INVALID));
  handle("hh:pluginsSetNotify", (id: unknown, on: unknown) => (isId(id) && typeof on === "boolean" ? act("Saving a plugin's notifications", () => ctl.setNotify(id, on)) : INVALID));

  // Refresh and Test run sources now (network, a command): a page can't make them run in a loop (B11). They share one
  // budget of REFRESH_PER_MINUTE; a Refresh runs one at a time per source, a Test one at a time per plugin.
  const busy = new Set<string>();
  let recent: number[] = [];
  const limited = async <T>(key: string, said: { busy: string; tooMany: string }, refuse: (message: string) => T, run: () => Promise<T>): Promise<T> => {
    if (busy.has(key)) return refuse(said.busy);
    const t = now();
    recent = recent.filter((at) => t - at < MINUTE);
    if (recent.length >= REFRESH_PER_MINUTE) return refuse(said.tooMany);
    recent.push(t);
    busy.add(key);
    try {
      return await run();
    } finally {
      busy.delete(key);
    }
  };
  // A refused Test answers one line named after the plugin (the window doesn't know its sources here).
  handle("hh:pluginsTest", async (id: unknown): Promise<PluginTestResult[]> =>
    isId(id) ? limited(`test\0${id}`, TEST_SAID, (error) => [{ source: id, ok: false, error }], () => read("Testing a plugin", () => ctl.test(id), [])) : [],
  );
  handle("hh:pluginsRefresh", async (id: unknown, source: unknown): Promise<PluginResult> =>
    isId(id) && isLocalId(source) ? limited(`refresh\0${id}\0${source}`, REFRESH_SAID, (message): PluginResult => ({ ok: false, message }), () => act("Refreshing a plugin source", () => ctl.refresh(id, source))) : INVALID,
  );

  handle("hh:attentionGet", (): Promise<AttentionView | null> => read("Reading the Attention inbox", () => ctl.attention.view(), null));
  handle("hh:attentionDismiss", async (plugin: unknown, key: unknown): Promise<void> => {
    if (!isId(plugin) || typeof key !== "string" || !ATTENTION_KEY.test(key)) return;
    await read("Dismissing an attention item", () => ctl.attention.dismiss(plugin, key), undefined);
  });
  // No arguments: every item; a plugin: its items; both: that one. A key without a plugin is refused.
  handle("hh:attentionRead", async (plugin: unknown, key: unknown): Promise<void> => {
    if (plugin !== undefined && !isId(plugin)) return;
    if (key !== undefined && (plugin === undefined || typeof key !== "string" || !ATTENTION_KEY.test(key))) return;
    await read("Marking attention items read", () => ctl.attention.read(plugin, key), undefined);
  });

  // ── part 2: the surface, panel calls, prepared tasks, attention targets ────

  handle("hh:pluginsSurface", (): PluginSurfaceView => {
    try {
      return ctl.surface();
    } catch (err) {
      log("Reading the plugin surface failed", err);
      return EMPTY_SURFACE;
    }
  });
  // P4: the window's PanelFrame names the plugin and panel of the frame it created; the controller checks them again
  // (running, declared) and each call's own arguments. A prepared task comes only through `requestAction` here.
  handle("hh:pluginsPanel", async (plugin: unknown, panel: unknown, call: unknown, args: unknown): Promise<PanelAnswer> => {
    if (!isId(plugin) || !isLocalId(panel) || typeof call !== "string" || !(PANEL_CALLS as readonly string[]).includes(call) || !panelArgs(args)) return PANEL_INVALID;
    try {
      return await ctl.panelCall(plugin, panel, call, args);
    } catch (err) {
      log("A panel call failed", err);
      return { ok: false, error: FAILED_MESSAGE };
    }
  });
  // P6, P13: Start sends only the card's token. What starts is what the controller kept for it, unchanged; the scope
  // and the app's holds are checked before the single-use token is spent.
  handle("hh:pluginsStartPrepared", async (token: unknown): Promise<PluginResult> => {
    if (typeof token !== "string" || !TOKEN.test(token)) return INVALID;
    const needScope: PluginResult = { ok: false, message: o.scopes ? `Open a ${o.scopes.label} first` : "Open a scope first" };
    try {
      const blocked = o.startBlocked?.() ?? null;
      if (blocked) return { ok: false, message: blocked };
      const card = ctl.surface().prepared;
      if (o.scopes && card?.token === token && card.scope === "open" && !(await o.scopes.open())) return needScope;
      const p = await ctl.takePrepared(token);
      if (!p) return NOT_PREPARED;
      // A turn may have started during the awaits above: the card is spent either way, but the answer says why.
      const late = o.startBlocked?.() ?? null;
      if (late) return { ok: false, message: late };
      try {
        await o.startPrepared(p);
      } catch (err) {
        if (err instanceof ScopeRequired) return needScope;
        // Past the refusals: the open task may have closed and the turn may have run, so the renderer keeps the line.
        log("Starting a prepared task failed", err);
        return { ok: false, message: FAILED_MESSAGE, started: true };
      }
      return { ok: true };
    } catch (err) {
      log("Starting a prepared task failed", err);
      return FAILED;
    }
  });
  handle("hh:pluginsCancelPrepared", (token: unknown): void => {
    if (typeof token === "string" && TOKEN.test(token)) ctl.cancelPrepared(token);
  });
  // Only the core's inbox calls this: the target is the stored item's, checked again now (Decision 12).
  handle("hh:attentionOpen", async (plugin: unknown, key: unknown): Promise<AttentionTarget> => {
    if (!isId(plugin) || typeof key !== "string" || !ATTENTION_KEY.test(key)) return { kind: "none" };
    return read("Opening an attention item", () => ctl.attention.open(plugin, key), { kind: "none" } as AttentionTarget);
  });
}

/**
 * Panels in an app window (plugins spec §5; P1–P3, P7): the default session's panel-only handler and request filter,
 * and the window's frame guard. Only with the controller (D0: a harness without plugins installs none of them), and
 * through PluginPanelsOnDemand only once a plugin with panels starts. The host asks `panelHost` at every request, so a
 * plugin that stops serves nothing from then on.
 */
export function installPluginPanels(win: Parameters<PluginBackendHost["installPanels"]>[0], host: Pick<PluginBackendHost, "installPanels"> | null, ctl: Pick<PluginsController, "panelHost"> | null): void {
  if (!host || !ctl) return;
  host.installPanels(win, (id) => ctl.panelHost(id));
}

/**
 * D0 for a harness that takes plugins but runs none with panels: `installPluginPanels` waits for the first plugin
 * with panels to start (`PluginsDeps.panelsNeeded`), then covers the current window and every later one. It stays
 * installed after that plugin stops (the handler serves nothing for a stopped plugin).
 */
export class PluginPanelsOnDemand<W> {
  private wanted = false;
  constructor(
    private readonly install: (win: W) => void,
    private readonly current: () => W | null,
  ) {}

  /** A plugin with panels is starting. */
  needed(): void {
    if (this.wanted) return;
    this.wanted = true;
    const win = this.current();
    if (win) this.install(win);
  }

  /** A new app window: installed only once panels were needed. */
  window(win: W): void {
    if (this.wanted) this.install(win);
  }
}

export { safeStorageCrypto } from "./secrets/safe-storage";
