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

export interface SharedConfig {
  version: 1;
  engines: Record<string, SharedEngineRecord>;
}

const FIELDS: readonly string[] = ["binary", "version", "notice", "verifiedAt"];
const empty = (): SharedConfig => ({ version: 1, engines: {} });

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
    try {
      const raw = JSON.parse(await fs.readFile(this.file, "utf8")) as Partial<SharedConfig> | null;
      if (raw?.version !== 1 || typeof raw.engines !== "object" || raw.engines === null) return empty();
      return { version: 1, engines: raw.engines };
    } catch {
      return empty();
    }
  }

  async engine(id: string): Promise<SharedEngineRecord> {
    return (await this.load()).engines[id] ?? {};
  }

  /** Merges `patch` into the engine's record. Unknown fields and undefined values are dropped. */
  update(id: string, patch: SharedEngineRecord): Promise<SharedEngineRecord> {
    const run = this.queue.then(async () => {
      const config = await this.load();
      const clean = Object.fromEntries(Object.entries(patch).filter(([k, v]) => FIELDS.includes(k) && v !== undefined));
      const next: SharedEngineRecord = { ...config.engines[id], ...clean };
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
}

/** Whether the record shows the legal notice accepted at the current version. */
export function noticeAccepted(record: SharedEngineRecord, currentVersion: number): boolean {
  return record.notice?.version === currentVersion;
}
