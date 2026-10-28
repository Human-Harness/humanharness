import { createHash, randomUUID } from "node:crypto";
import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { type AddedPermission, PLUGIN_ID, type PluginPermissions, permissionsAdded, pluginManifestSchema, z } from "@humanharness/harness-sdk";
import { pluginDataDir, pluginStateDir } from "@humanharness/workspace";
import type { PluginEntry } from "./plugin-load";

/**
 * A plugin's state per base (plugins spec §3.3, §7; Decisions 4–7). The person's settings and the error log live in
 * the base, under `.harness/plugins/<id>/` (never tracked by the history). What decides whether a plugin may run and
 * with which permissions (on/off, the approval snapshot) never lives in the base: the agent can write anything there,
 * and a forged or replayed approval would start a plugin without a review (B8). It lives in the app's per-harness
 * folder (`~/.humanharness/<harness-id>/`, beside the pointers file, B13) under `plugin-state/<hash of the base's real
 * path>/<id>.json`. Reading writes nothing (D0); every file is untrusted on read (hand-edited, half-written) and reads
 * as nothing when broken.
 *
 * The agent can also put a link anywhere in the base. Nothing under `.harness/` is followed: every folder from the base
 * down is checked with lstat (a link or anything but a folder is refused), files open with O_NOFOLLOW (and O_NONBLOCK,
 * so a named pipe never hangs a read), a hard-linked file is refused, and a removal never goes through a linked parent.
 */

export interface PluginApproval {
  version: string;
  permissions: PluginPermissions;
  distHash: string;
  at: string;
}

export interface PluginState {
  on: boolean;
  approved?: PluginApproval;
  /** Why it is off when the core turned it off. */
  offReason?: "review" | "crashed";
  /** The dist hash the person last saw in the detail; differs from the running one: "updated". */
  seenHash?: string;
  notify?: boolean;
}

export interface PluginErrorLine {
  at: string;
  source?: string;
  message: string;
}

/** Core-drawn work hours (Decision 4): 0 = Sunday; `from > to` spans midnight; `from = to` is the whole day. */
export interface WorkHours {
  days: number[];
  from: string;
  to: string;
  timezone: string;
}

const validZone = (tz: unknown): tz is string => {
  if (typeof tz !== "string" || tz === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

/** The system's zone, or UTC when it has none this runtime knows. */
export const DEFAULT_WORK_HOURS = (): WorkHours => {
  const tz: unknown = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", timezone: validZone(tz) ? tz : "UTC" };
};

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const workHoursSchema = z.strictObject({
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
  from: clock,
  to: clock,
  timezone: z.string().max(64).refine(validZone),
});

/** Well-formed work hours in a zone this machine knows, or null (stored values are untrusted). */
export function parseWorkHours(raw: unknown): WorkHours | null {
  const r = workHoursSchema.safeParse(raw);
  return r.success ? { ...r.data, days: [...new Set(r.data.days)].sort((a, b) => a - b) } : null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Whether `at` falls inside `wh` (valid hours: see `parseWorkHours`). The end is exclusive. */
export function inWorkHours(wh: WorkHours, at: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: wh.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const day = WEEKDAYS.indexOf(part("weekday"));
  const now = Number(part("hour")) * 60 + Number(part("minute"));
  const from = minutes(wh.from);
  const to = minutes(wh.to);
  if (from === to) return wh.days.includes(day);
  if (from < to) return wh.days.includes(day) && now >= from && now < to;
  // Spans midnight: the hours after midnight belong to the day the window started.
  if (now >= from) return wh.days.includes(day);
  return now < to && wh.days.includes((day + 6) % 7);
}

export type ReviewStatus = {
  run: boolean;
  status: "on" | "off" | "review" | "crashed" | "error";
  added: AddedPermission[];
  updated: boolean;
  /** Start it and take the approval snapshot from the current manifest (a bundled plugin in `plugins.on`, Decision 5). */
  approve?: true;
};

/**
 * Whether a plugin runs, and what Settings shows (Decisions 5–6, B8). `harnessOn`: the harness lists it in `plugins.on`.
 * A plugin runs only on the permissions the person (or the harness, for its own) approved: a `dist/` that adds any
 * turns it off until reviewed; fewer never ask.
 */
export function reviewStatus(entry: PluginEntry, state: PluginState | null, harnessOn: boolean): ReviewStatus {
  const off = (status: ReviewStatus["status"], added: AddedPermission[] = []): ReviewStatus => ({ run: false, status, added, updated: false });
  if (entry.error !== undefined || entry.manifest === null) return off("error");
  if (entry.origin === "dev") return { run: true, status: "on", added: [], updated: false };
  const harnessStart = entry.origin === "bundled" && harnessOn;
  const startApproving = (): ReviewStatus => (harnessStart ? { run: true, status: "on", added: [], updated: false, approve: true } : off("off"));
  if (state === null) return startApproving();
  const added = state.approved ? permissionsAdded(state.approved.permissions, entry.manifest.permissions) : [];
  if (!state.on) return off(state.offReason === "crashed" ? "crashed" : state.offReason === "review" ? "review" : "off", added);
  // On with no approval: only a hand-written state; the harness's own plugin takes its snapshot, anything else stays off.
  if (!state.approved) return startApproving();
  if (added.length > 0) return off("review", added);
  return { run: true, status: "on", added: [], updated: entry.distHash !== (state.seenHash ?? state.approved.distHash) };
}

const approvalSchema = z.object({
  version: z.string().max(80),
  permissions: pluginManifestSchema.shape.permissions,
  distHash: z.string().max(128),
  at: z.string().max(40),
});

/** Only what the app understands; a field that doesn't parse is dropped (an approval that doesn't: no approval). */
function cleanState(raw: unknown): PluginState | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: PluginState = { on: r.on === true };
  const approved = approvalSchema.safeParse(r.approved);
  if (approved.success) out.approved = approved.data;
  if (r.offReason === "review" || r.offReason === "crashed") out.offReason = r.offReason;
  if (typeof r.seenHash === "string" && r.seenHash.length <= 128) out.seenHash = r.seenHash;
  if (typeof r.notify === "boolean") out.notify = r.notify;
  return out;
}

/** Decision 21: the error log keeps its newest lines within this size. */
const ERROR_LOG_MAX_BYTES = 256 * 1024;
/** Read caps: a file past them reads as nothing (the error log gets room for a line written past its cap). */
const ERROR_LOG_READ_MAX = ERROR_LOG_MAX_BYTES + 64 * 1024;
const JSON_READ_MAX = 1024 * 1024;
/** B11: one log line's message. */
const ERROR_MESSAGE_MAX = 2000;
const ERROR_SOURCE_MAX = 64;

function cleanError(raw: unknown): PluginErrorLine | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { at, source, message } = raw as Record<string, unknown>;
  if (typeof at !== "string" || typeof message !== "string" || (source !== undefined && typeof source !== "string")) return null;
  return source === undefined ? { at, message } : { at, source, message };
}

/** The folder in the app's per-harness folder that holds each base's run state (`<appDir>/plugin-state/<key>/`). */
export const PLUGIN_STATE_DIR = "plugin-state";

/** A base's run-state folder name: the SHA-256 of its real path, 32 hex chars (moving the folder carries it, move-folder). */
export const pluginStateKey = (realBase: string): string => createHash("sha256").update(realBase).digest("hex").slice(0, 32);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Remove (Decision 19): the plugin's run state in every base (`<appDir>/plugin-state/<key>/<id>.json` for every key), not only the
 * current one, so a later plugin with the same id never starts on in another profile on an old approval (B8). The app's
 * own folder, still checked: a linked `plugin-state` or base folder is skipped (never followed), and a linked `<id>.json`
 * is removed itself. Every folder is tried; the call rejects after if one could not be cleared.
 */
export async function removeRunStateEverywhere(appDir: string, id: string): Promise<void> {
  if (typeof id !== "string" || !PLUGIN_ID.test(id)) throw new Error(`Invalid plugin id`);
  const root = path.join(appDir, PLUGIN_STATE_DIR);
  const st = await fs.lstat(root).catch((err: NodeJS.ErrnoException) => {
    if (err.code === "ENOENT") return null;
    throw err;
  });
  if (st === null) return;
  if (!st.isDirectory()) throw new Error(`${PLUGIN_STATE_DIR} is ${st.isSymbolicLink() ? "a link" : "not a folder"}; refusing`);
  let failed: unknown = null;
  // withFileTypes reports what lstat would: a link to a folder is not a folder here.
  for (const e of await fs.readdir(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    await fs.rm(path.join(root, e.name, `${id}.json`), { force: true }).catch((err: unknown) => (failed ??= err));
  }
  if (failed !== null) throw failed;
}

/**
 * One base's plugin state files. `appDir` is the app's per-harness folder (`~/.humanharness/<harness-id>/`), where
 * the run state lives. Writes go one at a time (a promise chain) and are atomic (temp + rename). Every method checks
 * the id before it builds a path (an async rejection, never a path outside the plugin's folders).
 */
export class PluginStateStore {
  private writes: Promise<unknown> = Promise.resolve();
  private stateFolder: Promise<string> | null = null;

  constructor(
    private readonly base: string,
    private readonly appDir: string,
  ) {}

  /** The folders from the base down to the plugin's state folder (`.harness/plugins/<id>`); throws on a bad id. */
  private parts(dir: string): string[] {
    return path.relative(this.base, dir).split(path.sep);
  }

  /**
   * `<appDir>/plugin-state/<sha256 of the base's real path>/<id>.json`: one base's run state, outside it. A base whose
   * real path can't be resolved has no run state (never a guessed key another base could share).
   */
  private async stateFile(id: string): Promise<string> {
    pluginStateDir(this.base, id);
    this.stateFolder ??= fs.realpath(this.base).then(
      (real) => path.join(this.appDir, PLUGIN_STATE_DIR, pluginStateKey(real)),
      (err) => {
        this.stateFolder = null;
        throw err;
      },
    );
    return path.join(await this.stateFolder, `${id}.json`);
  }

  /** On/off and the approval: read only from the app's folder, never from the base (B8). */
  async state(id: string): Promise<PluginState | null> {
    pluginStateDir(this.base, id);
    let file: string;
    try {
      file = await this.stateFile(id);
    } catch (err) {
      console.warn(`[plugins] ${id}: the base's real path can't be resolved (${(err as Error).message}); no state`);
      return null;
    }
    const raw = parseJson(id, "state", await readText(file, JSON_READ_MAX));
    if (raw === undefined || raw === null) return null;
    const state = cleanState(raw);
    if (state === null) console.warn(`[plugins] ${id}: the stored state is not a state; reading it as none`);
    return state;
  }

  /** Merges `patch` into the stored state (a key set to undefined is removed) and returns the result. */
  async setState(id: string, patch: Partial<PluginState>): Promise<PluginState> {
    const file = await this.stateFile(id);
    return this.queue(async () => {
      const next = { ...((await this.state(id)) ?? { on: false }), ...patch };
      // The app's own folder: not the agent's to link, so a plain mkdir.
      await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      await writeAtomic(path.dirname(file), path.basename(file), `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      return cleanState(JSON.parse(JSON.stringify(next))) as PluginState;
    });
  }

  /** The stored values only (work hours included when set); the caller checks them against the plugin's settings. */
  async settings(id: string): Promise<Record<string, unknown>> {
    const raw = parseJson(id, "settings.json", await this.readBase(id, "settings.json", JSON_READ_MAX));
    if (raw === undefined || raw === null) return {};
    if (!isRecord(raw)) {
      console.warn(`[plugins] ${id}: settings.json is not an object; reading it as empty`);
      return {};
    }
    return raw;
  }

  /** Stores only the changed values; `{}` removes the file. */
  async setSettings(id: string, values: Record<string, unknown>): Promise<void> {
    const parts = this.parts(pluginStateDir(this.base, id));
    return this.queue(async () => {
      if (Object.keys(values).length === 0) {
        const dir = await folderChain(this.base, parts, false);
        if (dir !== null) await fs.rm(path.join(dir, "settings.json"), { force: true });
        return;
      }
      const dir = (await folderChain(this.base, parts, true)) as string;
      await writeAtomic(dir, "settings.json", `${JSON.stringify(values, null, 2)}\n`, { recheck: () => folderChain(this.base, parts, false) });
    });
  }

  /** Oldest first; a line that doesn't parse is skipped. */
  async errors(id: string): Promise<PluginErrorLine[]> {
    const text = await this.readBase(id, "errors.jsonl", ERROR_LOG_READ_MAX);
    if (text === null) return [];
    const out: PluginErrorLine[] = [];
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      let raw: unknown;
      try {
        raw = JSON.parse(line);
      } catch {
        continue;
      }
      const e = cleanError(raw);
      if (e) out.push(e);
    }
    return out;
  }

  /** Appends one line (bounded, B11); past 256 KB the oldest lines go. */
  async appendError(id: string, e: PluginErrorLine): Promise<void> {
    const parts = this.parts(pluginStateDir(this.base, id));
    const clean: PluginErrorLine = { at: String(e.at).slice(0, 40), ...(e.source === undefined ? {} : { source: String(e.source).slice(0, ERROR_SOURCE_MAX) }), message: String(e.message).slice(0, ERROR_MESSAGE_MAX) };
    const line = `${JSON.stringify(clean)}\n`;
    return this.queue(async () => {
      const dir = (await folderChain(this.base, parts, true)) as string;
      const file = path.join(dir, "errors.jsonl");
      const h = await fs.open(file, constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | NOFOLLOW | NONBLOCK, 0o644);
      try {
        const st = await h.stat();
        if (!st.isFile() || st.nlink > 1) throw new Error(`errors.jsonl is not a plain file; refusing to append`);
        if (st.size + Buffer.byteLength(line) <= ERROR_LOG_MAX_BYTES) {
          await h.write(line);
          return;
        }
      } finally {
        await h.close();
      }
      const lines = ((await readText(file, ERROR_LOG_READ_MAX)) ?? "").split("\n").filter((l) => l !== "");
      lines.push(line.slice(0, -1));
      let total = 0;
      let keep = lines.length;
      while (keep > 0 && total + Buffer.byteLength(lines[keep - 1]) + 1 <= ERROR_LOG_MAX_BYTES) total += Buffer.byteLength(lines[--keep]) + 1;
      await writeAtomic(dir, "errors.jsonl", lines.slice(keep).map((l) => `${l}\n`).join(""), { recheck: () => folderChain(this.base, parts, false) });
    });
  }

  /**
   * Remove (Decision 19): the plugin's run state, its state folder and its data in this base. The run state goes first
   * (the app's folder); a folder in the base behind a linked parent is left alone and the call rejects. A linked
   * `<id>` entry is removed itself, never what it points to.
   */
  async removeAll(id: string): Promise<void> {
    const file = await this.stateFile(id);
    const dirs = [pluginStateDir(this.base, id), pluginDataDir(this.base, id)].map((d) => this.parts(d));
    return this.queue(async () => {
      await fs.rm(file, { force: true });
      for (const parts of dirs) {
        const parent = await folderChain(this.base, parts.slice(0, -1), false);
        if (parent === null) continue;
        // rm on a link removes the link; inside a real folder it never follows links.
        await fs.rm(path.join(parent, parts[parts.length - 1]), { recursive: true, force: true });
      }
    });
  }

  /** A file in the plugin's state folder in the base, or null (missing, behind a link, not a plain file, too big). */
  private async readBase(id: string, name: string, max: number): Promise<string | null> {
    const parts = this.parts(pluginStateDir(this.base, id));
    let dir: string | null;
    try {
      dir = await folderChain(this.base, parts, false);
    } catch (err) {
      console.warn(`[plugins] ${id}: ${(err as Error).message}; reading ${name} as none`);
      return null;
    }
    return dir === null ? null : readText(path.join(dir, name), max);
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn);
    this.writes = run.catch(() => undefined);
    return run;
  }
}

const NOFOLLOW = constants.O_NOFOLLOW ?? 0;
const NONBLOCK = constants.O_NONBLOCK ?? 0;

/** undefined: no file. A file that isn't JSON reads as `null` (logged). */
function parseJson(id: string, name: string, text: string | null): unknown {
  if (text === null) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    console.warn(`[plugins] ${id}: ${name} is not JSON; reading it as none`);
    return null;
  }
}

/**
 * Walks `parts` down from `base`, refusing a link or anything but a folder at each step; with `create`, makes the
 * missing ones one at a time. The last folder, or null when one is missing and `create` is false.
 */
async function folderChain(base: string, parts: string[], create: boolean): Promise<string | null> {
  let dir = base;
  for (const part of parts) {
    dir = path.join(dir, part);
    let st = await fs.lstat(dir).catch((err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") return null;
      throw err;
    });
    if (st === null) {
      if (!create) return null;
      await fs.mkdir(dir).catch((err: NodeJS.ErrnoException) => {
        if (err.code !== "EEXIST") throw err;
      });
      st = await fs.lstat(dir);
    }
    if (!st.isDirectory()) throw new Error(`${path.relative(base, dir)} is ${st.isSymbolicLink() ? "a link" : "not a folder"}; refusing`);
  }
  return dir;
}

/**
 * At most `max` bytes of a plain file, as text; null when missing or anything else (a link, a hard link, a folder, a
 * pipe, too big, unreadable: logged). Never follows a link at the last step and never blocks on a pipe.
 */
async function readText(file: string, max: number): Promise<string | null> {
  let h: fs.FileHandle | undefined;
  try {
    h = await fs.open(file, constants.O_RDONLY | NOFOLLOW | NONBLOCK);
    const st = await h.stat();
    if (!st.isFile()) throw new Error("not a regular file");
    if (st.nlink > 1) throw new Error("hard-linked");
    const buf = Buffer.alloc(max + 1);
    let n = 0;
    while (n < buf.length) {
      const { bytesRead } = await h.read(buf, n, buf.length - n, n);
      if (bytesRead === 0) break;
      n += bytesRead;
    }
    if (n > max) throw new Error(`over ${max} bytes`);
    return buf.subarray(0, n).toString("utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[plugins] ${path.basename(path.dirname(file))}: ${path.basename(file)} can't be read (${(err as Error).message}); reading it as none`);
    return null;
  } finally {
    await h?.close();
  }
}

/**
 * Writes `name` in `dir` atomically: a fresh temp file (O_EXCL, O_NOFOLLOW), then a rename over the target, which must
 * be a plain file or missing. `recheck` walks the folders again right before the rename (the base's: one may have been
 * swapped for a link meanwhile).
 */
async function writeAtomic(dir: string, name: string, text: string, o: { mode?: number; recheck?: () => Promise<unknown> } = {}): Promise<void> {
  const file = path.join(dir, name);
  const tmp = path.join(dir, `${name}.${randomUUID()}.tmp`);
  try {
    const h = await fs.open(tmp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | NOFOLLOW, o.mode ?? 0o644);
    try {
      await h.writeFile(text);
    } finally {
      await h.close();
    }
    if (o.recheck) await o.recheck();
    const st = await fs.lstat(file).catch(() => null);
    if (st !== null && !st.isFile()) throw new Error(`${name} is ${st.isSymbolicLink() ? "a link" : "not a regular file"}; refusing to replace it`);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
