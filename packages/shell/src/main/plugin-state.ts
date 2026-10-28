import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type AddedPermission, type PluginPermissions, permissionsAdded, pluginManifestSchema, z } from "@humanharness/harness-sdk";
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

export const DEFAULT_WORK_HOURS = (): WorkHours => ({ days: [1, 2, 3, 4, 5], from: "09:00", to: "18:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone });

const validZone = (tz: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
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
/** B11: one log line's message. */
const ERROR_MESSAGE_MAX = 2000;
const ERROR_SOURCE_MAX = 64;

function cleanError(raw: unknown): PluginErrorLine | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { at, source, message } = raw as Record<string, unknown>;
  if (typeof at !== "string" || typeof message !== "string" || (source !== undefined && typeof source !== "string")) return null;
  return source === undefined ? { at, message } : { at, source, message };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

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

  private file(id: string, name: string): string {
    return path.join(pluginStateDir(this.base, id), name);
  }

  /** `<appDir>/plugin-state/<sha256 of the base's real path>/<id>.json`: one base's run state, outside it. */
  private async stateFile(id: string): Promise<string> {
    pluginStateDir(this.base, id);
    this.stateFolder ??= fs
      .realpath(this.base)
      .catch(() => path.resolve(this.base))
      .then((real) => path.join(this.appDir, "plugin-state", createHash("sha256").update(real).digest("hex").slice(0, 32)));
    return path.join(await this.stateFolder, `${id}.json`);
  }

  /** On/off and the approval: read only from the app's folder, never from the base (B8). */
  async state(id: string): Promise<PluginState | null> {
    const raw = await this.readJson(await this.stateFile(id));
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
      await writeAtomic(file, `${JSON.stringify(next, null, 2)}\n`, true);
      return cleanState(JSON.parse(JSON.stringify(next))) as PluginState;
    });
  }

  /** The stored values only (work hours included when set); the caller checks them against the plugin's settings. */
  async settings(id: string): Promise<Record<string, unknown>> {
    const raw = await this.readJson(this.file(id, "settings.json"));
    if (raw === undefined) return {};
    if (!isRecord(raw)) {
      console.warn(`[plugins] ${id}: settings.json is not an object; reading it as empty`);
      return {};
    }
    return raw;
  }

  /** Stores only the changed values; `{}` removes the file. */
  async setSettings(id: string, values: Record<string, unknown>): Promise<void> {
    const file = this.file(id, "settings.json");
    return this.queue(async () => {
      if (Object.keys(values).length === 0) await fs.rm(file, { force: true });
      else await writeAtomic(file, `${JSON.stringify(values, null, 2)}\n`);
    });
  }

  /** Oldest first; a line that doesn't parse is skipped. */
  async errors(id: string): Promise<PluginErrorLine[]> {
    const text = await readText(this.file(id, "errors.jsonl"));
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
    const file = this.file(id, "errors.jsonl");
    const clean: PluginErrorLine = { at: String(e.at).slice(0, 40), ...(e.source === undefined ? {} : { source: String(e.source).slice(0, ERROR_SOURCE_MAX) }), message: String(e.message).slice(0, ERROR_MESSAGE_MAX) };
    const line = `${JSON.stringify(clean)}\n`;
    return this.queue(async () => {
      const size = await fs.stat(file).then((s) => s.size, () => null);
      if (size === null || size + Buffer.byteLength(line) <= ERROR_LOG_MAX_BYTES) {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.appendFile(file, line);
        return;
      }
      const lines = ((await readText(file)) ?? "").split("\n").filter((l) => l !== "");
      lines.push(line.slice(0, -1));
      let total = 0;
      let keep = lines.length;
      while (keep > 0 && total + Buffer.byteLength(lines[keep - 1]) + 1 <= ERROR_LOG_MAX_BYTES) total += Buffer.byteLength(lines[--keep]) + 1;
      await writeAtomic(file, lines.slice(keep).map((l) => `${l}\n`).join(""));
    });
  }

  /** Remove (Decision 19): the plugin's run state, its state folder and its data in this base. */
  async removeAll(id: string): Promise<void> {
    const file = await this.stateFile(id);
    const dirs = [pluginStateDir(this.base, id), pluginDataDir(this.base, id)];
    return this.queue(async () => {
      await fs.rm(file, { force: true });
      for (const dir of dirs) await fs.rm(dir, { recursive: true, force: true });
    });
  }

  /** undefined: no file. A file that isn't JSON reads as `null` (logged). */
  private async readJson(file: string): Promise<unknown> {
    const text = await readText(file);
    if (text === null) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      console.warn(`[plugins] ${path.basename(path.dirname(file))}: ${path.basename(file)} is not JSON; reading it as none`);
      return null;
    }
  }

  private queue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn);
    this.writes = run.catch(() => undefined);
    return run;
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await fs.readFile(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

/** `private`: the app's own folder (folders 0700, file 0600, like the secrets). */
async function writeAtomic(file: string, text: string, priv = false): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true, ...(priv ? { mode: 0o700 } : {}) });
  const tmp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, text, priv ? { mode: 0o600 } : undefined);
    await fs.rename(tmp, file);
  } catch (err) {
    await fs.rm(tmp, { force: true });
    throw err;
  }
}
