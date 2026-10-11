import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

/** What every Human Harness app on this computer knows about one engine. Never credentials. */
export interface SharedEngineRecord {
  /** Absolute path of the CLI found last time (informational: it is detected again on every check). */
  binary?: string;
  version?: string;
  /** The legal notice the user accepted, and when. */
  notice?: { version: number; acceptedAt: string };
  /** Last time a test prompt succeeded. */
  verifiedAt?: string;
}

/** A change to a record: `null` deletes the field, undefined leaves it as it is. */
export type SharedEnginePatch = { [K in keyof SharedEngineRecord]?: SharedEngineRecord[K] | null };

export interface SharedConfig {
  version: 1;
  engines: Record<string, SharedEngineRecord>;
}

const FIELDS: readonly string[] = ["binary", "version", "notice", "verifiedAt"];
const empty = (): SharedConfig => ({ version: 1, engines: {} });

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Keeps only the known fields, each with the right type; drops everything else. */
function cleanRecord(raw: Record<string, unknown>): SharedEngineRecord {
  const record: SharedEngineRecord = {};
  if (typeof raw.binary === "string") record.binary = raw.binary;
  if (typeof raw.version === "string") record.version = raw.version;
  if (typeof raw.verifiedAt === "string") record.verifiedAt = raw.verifiedAt;
  const notice = raw.notice;
  if (isPlainObject(notice) && typeof notice.version === "number" && typeof notice.acceptedAt === "string") {
    record.notice = { version: notice.version, acceptedAt: notice.acceptedAt };
  }
  return record;
}

export function sharedConfigDir(home: string = os.homedir()): string {
  return path.join(home, ".humanharness");
}

/**
 * `~/.humanharness/engines.json`, shared by every harness app. Each update re-reads the file and
 * writes atomically (temp file + rename), so apps don't drop each other's earlier changes.
 */
export class SharedConfigStore {
  private readonly file: string;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(dir: string) {
    this.file = path.join(dir, "engines.json");
  }

  /** Where the file is (for "Show in Finder"). */
  get path(): string {
    return this.file;
  }

  /**
   * Starts the file over when it can't be used (damaged, or from a newer app): the old one is kept
   * next to it as `engines.json.bak-<date>-<time>` (`-2`, `-3`… when that name is taken), whose path is returned (null when there was none).
   * Every engine then asks for its notice and test again.
   */
  reset(now: Date = new Date()): Promise<string | null> {
    const run = this.queue.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const stamp = now.toISOString().replace(/\.\d+Z$/, "").replace(/-|:/g, "").replace("T", "-");
      const backup = await this.backup(`${this.file}.bak-${stamp}`);
      await this.write(empty());
      return backup;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Copies the file to `base` (or `base-2`, `base-3`… when taken), never replacing an existing
   * backup. Returns the backup's path, or null when there is no file.
   */
  private async backup(base: string): Promise<string | null> {
    for (let n = 1; ; n++) {
      const target = n === 1 ? base : `${base}-${n}`;
      try {
        await fs.copyFile(this.file, target, fsConstants.COPYFILE_EXCL);
        return target;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return null;
        if (code !== "EEXIST" || n >= 1000) throw err;
      }
    }
  }

  private async write(content: unknown): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(content, null, 2) + "\n");
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  async load(): Promise<SharedConfig> {
    return (await this.read()).config;
  }

  async engine(id: string): Promise<SharedEngineRecord> {
    return (await this.load()).engines[id] ?? {};
  }

  /**
   * Merges `patch` into the engine's record: `null` deletes a field; undefined values and unknown
   * patch fields are ignored. Fields and engines in the file that this app doesn't know are kept
   * as they are. Rejects without writing when the file can't be read or parsed, or has an unknown
   * (e.g. newer) format; a missing file is created.
   */
  update(id: string, patch: SharedEnginePatch): Promise<SharedEngineRecord> {
    const run = this.queue.then(async () => {
      const { raw, unwritable } = await this.read();
      if (unwritable) throw new Error(`${this.file} ${unwritable}; not overwriting it`);
      const engines = isPlainObject(raw?.engines) ? raw.engines : {};
      const current = isPlainObject(engines[id]) ? engines[id] : {};
      // Unknown fields stay as they are; known ones are re-cleaned after the patch.
      const merged: Record<string, unknown> = { ...current };
      for (const k of FIELDS) delete merged[k];
      Object.assign(merged, cleanRecord(current));
      for (const [k, v] of Object.entries(patch)) {
        if (!FIELDS.includes(k) || v === undefined) continue;
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      const next = cleanRecord(merged);
      for (const k of FIELDS) delete merged[k];
      const file = { ...raw, version: 1, engines: { ...engines, [id]: { ...merged, ...next } } };
      await this.write(file);
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * The file's contents, cleaned, plus the raw object for writing back. A missing file is empty and
   * writable; `unwritable` says why any other file (unreadable, unparseable, unknown format) must
   * not be overwritten.
   */
  private async read(): Promise<{ config: SharedConfig; raw: Record<string, unknown> | null; unwritable?: string }> {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return { config: empty(), raw: null };
      return { config: empty(), raw: null, unwritable: "could not be read" };
    }
    if (!isPlainObject(raw) || raw.version !== 1) return { config: empty(), raw: null, unwritable: "has an unknown format version" };
    if (raw.engines !== undefined && !isPlainObject(raw.engines)) return { config: empty(), raw: null, unwritable: "has an unknown format" };
    const engines: Record<string, SharedEngineRecord> = {};
    for (const [id, record] of Object.entries(raw.engines ?? {})) {
      if (isPlainObject(record)) engines[id] = cleanRecord(record);
    }
    return { config: { version: 1, engines }, raw };
  }
}

/** Whether the record shows the legal notice accepted at the current version. */
export function noticeAccepted(record: SharedEngineRecord, currentVersion: number): boolean {
  return record.notice?.version === currentVersion;
}
