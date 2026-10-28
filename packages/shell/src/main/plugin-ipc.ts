import { PLUGIN_ID, PLUGIN_LOCAL_ID, SETTING_NAME } from "@humanharness/harness-sdk";
import type { AttentionView, PluginDetail, PluginPick, PluginResult, PluginsView, PluginTestResult } from "@humanharness/ui/client";
import type { PluginsController } from "./plugins";
import type { SecretCrypto } from "./plugin-secrets";

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
> & { attention: Pick<PluginsController["attention"], "view" | "dismiss" | "read"> };

const INVALID: PluginResult = { ok: false, message: "Invalid request" };
const FAILED_MESSAGE = "Something went wrong";
const FAILED: PluginResult = { ok: false, message: FAILED_MESSAGE };
/** A pick's token (PluginsController.pick: 16 random bytes in hex). */
const TOKEN = /^[0-9a-f]{32}$/;
/** A dist hash (sha256 hex): what the review showed, sent back by Approve. */
const HASH = /^[0-9a-f]{64}$/;
/** An attention item's key (the broker's and the scheduler's keys, e.g. `sync-failing:<source>`). */
const ATTENTION_KEY = /^[A-Za-z0-9:._-]{1,80}$/;
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

export function registerPluginsIpc(handle: Handle, ctl: Ctl, o: { now?: () => number; log?: (message: string, err?: unknown) => void } = {}): void {
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
}

/**
 * The SecretStore's crypto over Electron's safeStorage (Decision 17). On Linux without a keyring safeStorage
 * "encrypts" with a hard-coded key (`basic_text`): that counts as unavailable, so keys are refused, never stored in
 * the clear.
 */
export function safeStorageCrypto(
  storage: Pick<typeof import("electron").safeStorage, "isEncryptionAvailable" | "encryptString" | "decryptString" | "getSelectedStorageBackend">,
  platform: NodeJS.Platform = process.platform,
): SecretCrypto {
  return {
    available: () => {
      try {
        if (!storage.isEncryptionAvailable()) return false;
        return platform !== "linux" || storage.getSelectedStorageBackend() !== "basic_text";
      } catch {
        return false;
      }
    },
    encrypt: (text) => storage.encryptString(text),
    decrypt: (data) => storage.decryptString(data),
  };
}
