import { type DataKey, type DataRecord, type PluginManifest, pluginCollections } from "@humanharness/harness-sdk";
import {
  APP_SCOPE,
  type DataChange,
  DataError,
  type DataQuery,
  type DataQueryResult,
  DataStore,
  isDataWrite,
  pluginDataDir,
  runDataRequest,
} from "@humanharness/workspace";

/** B11: what one plugin's collection may hold. */
export const PLUGIN_DATA_LIMITS = { records: 2000, recordBytes: 64 * 1024, fileBytes: 2 * 1024 * 1024 } as const;

const APP = { who: "app" as const, scope: APP_SCOPE };

function sizeOf(value: unknown): number {
  let text: string | undefined;
  try {
    text = JSON.stringify(value);
  } catch {
    throw new DataError("invalid", "A record is plain JSON data");
  }
  return Buffer.byteLength(text ?? "", "utf8");
}

/**
 * One plugin's collections in one base (plugins spec §4.2 `ctx.data`, D10): a rebuildable cache under
 * `.harness/plugin-data/<id>/`, never tracked by the history, read and written without following links (the agent
 * can plant one in the base). The plugin writes as the app, only its own collections (B4), within the caps (B11);
 * the agent reads its `agent: "read"` collections through `agentRequest` and never writes.
 */
export class PluginData {
  private readonly store: DataStore;
  /** Writes one at a time, so the caps hold between the check and the write. */
  private writes: Promise<unknown> = Promise.resolve();

  constructor(base: string, manifest: PluginManifest, opts: { log?: (message: string) => void } = {}) {
    this.store = new DataStore(base, pluginCollections(manifest), {
      dir: pluginDataDir(base, manifest.id),
      // Pretty-printed records take more room than their JSON: room for the cap plus indentation.
      maxFileBytes: PLUGIN_DATA_LIMITS.fileBytes * 2,
      ...(opts.log ? { log: opts.log } : {}),
    });
  }

  get(collection: string, key?: DataKey): Promise<DataRecord | null> {
    return this.store.get(collection, key, APP);
  }

  query(collection: string, q: DataQuery = {}): Promise<DataQueryResult> {
    return this.store.query(collection, q, APP);
  }

  async readAll(collection: string): Promise<DataRecord[]> {
    return (await this.store.readAll(collection, APP_SCOPE)).records;
  }

  put(collection: string, record: DataRecord): Promise<void> {
    return this.serialize(async () => {
      const c = this.store.collection(collection);
      this.checkRecord(record);
      const current = await this.readAll(collection);
      const key = c.single ? undefined : record[c.key!];
      const others = c.single ? [] : current.filter((r) => r[c.key!] !== key);
      this.checkCollection([...others, record]);
      await this.store.put(collection, record, APP);
    });
  }

  patch(collection: string, key: DataKey | undefined, patch: DataRecord): Promise<void> {
    return this.serialize(async () => {
      const c = this.store.collection(collection);
      const current = await this.readAll(collection);
      const prev = c.single ? current[0] : current.find((r) => r[c.key!] === key);
      if (prev) {
        const next = { ...prev, ...patch };
        this.checkRecord(next);
        this.checkCollection(current.map((r) => (r === prev ? next : r)));
      }
      await this.store.patch(collection, key, patch, APP);
    });
  }

  delete(collection: string, key?: DataKey): Promise<void> {
    return this.serialize(async () => {
      await this.store.delete(collection, key, APP);
    });
  }

  replaceAll(collection: string, records: DataRecord[]): Promise<void> {
    return this.serialize(async () => {
      this.store.collection(collection);
      if (records.length > PLUGIN_DATA_LIMITS.records) throw this.tooMany();
      for (const r of records) this.checkRecord(r);
      this.checkCollection(records);
      await this.store.replaceAll(collection, records, APP);
    });
  }

  /** The agent's `data_get`/`data_query` on this plugin's `agent: "read"` collections (never writes). */
  agentRequest(request: unknown): Promise<unknown> {
    if (isDataWrite(request)) return Promise.reject(new DataError("refused", "The agent may not change plugin data: it is read-only"));
    return runDataRequest(this.store, request, { who: "agent", scope: APP_SCOPE });
  }

  onChange(listener: (change: DataChange) => void): () => void {
    return this.store.onChange(listener);
  }

  private checkRecord(record: unknown): void {
    if (sizeOf(record) > PLUGIN_DATA_LIMITS.recordBytes) throw new DataError("invalid", "The record is too large (at most 64 KB)");
  }

  private checkCollection(records: DataRecord[]): void {
    if (records.length > PLUGIN_DATA_LIMITS.records) throw this.tooMany();
    if (sizeOf(records) > PLUGIN_DATA_LIMITS.fileBytes) throw new DataError("invalid", "The collection is too large (at most 2 MB)");
  }

  private tooMany(): DataError {
    return new DataError("invalid", `A collection holds at most ${PLUGIN_DATA_LIMITS.records} records`);
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn, fn);
    this.writes = run.catch(() => undefined);
    return run;
  }
}
