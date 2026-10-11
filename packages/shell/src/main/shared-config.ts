import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
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

  async load(): Promise<SharedConfig> {
    return (await this.read()).config;
  }

  async engine(id: string): Promise<SharedEngineRecord> {
    return (await this.load()).engines[id] ?? {};
  }

  /**
   * Merges `patch` into the engine's record: `null` deletes a field; undefined values and unknown
   * fields are ignored. Rejects without writing when the file has an unknown (e.g. newer) format.
   */
  update(id: string, patch: SharedEnginePatch): Promise<SharedEngineRecord> {
    const run = this.queue.then(async () => {
      const { config, foreign } = await this.read();
      if (foreign) throw new Error(`${this.file} has an unknown format version; not overwriting it`);
      const merged: Record<string, unknown> = { ...config.engines[id] };
      for (const [k, v] of Object.entries(patch)) {
        if (!FIELDS.includes(k) || v === undefined) continue;
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      const next = cleanRecord(merged);
      config.engines[id] = next;
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(tmp, JSON.stringify(config, null, 2) + "\n");
        await fs.rename(tmp, this.file);
      } catch (err) {
        await fs.rm(tmp, { force: true });
        throw err;
      }
      return next;
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * The file's contents, cleaned (missing or unparseable → empty). `foreign` is true for a readable
   * file of another format version, which this app must not overwrite.
   */
  private async read(): Promise<{ config: SharedConfig; foreign: boolean }> {
    let raw: unknown;
    try {
      raw = JSON.parse(await fs.readFile(this.file, "utf8"));
    } catch {
      return { config: empty(), foreign: false };
    }
    if (!isPlainObject(raw)) return { config: empty(), foreign: false };
    if (raw.version !== 1) return { config: empty(), foreign: raw.version !== undefined };
    if (!isPlainObject(raw.engines)) return { config: empty(), foreign: false };
    const engines: Record<string, SharedEngineRecord> = {};
    for (const [id, record] of Object.entries(raw.engines)) {
      if (isPlainObject(record)) engines[id] = cleanRecord(record);
    }
    return { config: { version: 1, engines }, foreign: false };
  }
}

/** Whether the record shows the legal notice accepted at the current version. */
export function noticeAccepted(record: SharedEngineRecord, currentVersion: number): boolean {
  return record.notice?.version === currentVersion;
}
