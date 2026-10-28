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
      // Measured on what is stored: each record after the schema's defaults, the file as written (pretty-printed).
      // A file already over the cap can still shrink, and replaceAll clears one too large to read.
      maxFileBytes: PLUGIN_DATA_LIMITS.fileBytes,
      maxRecordBytes: PLUGIN_DATA_LIMITS.recordBytes,
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
      if (!c.single) {
        const current = await this.readAll(collection);
        const key = record?.[c.key!];
        if (!current.some((r) => r[c.key!] === key) && current.length >= PLUGIN_DATA_LIMITS.records) throw this.tooMany();
      }
      await this.store.put(collection, record, APP);
    });
  }

  patch(collection: string, key: DataKey | undefined, patch: DataRecord): Promise<void> {
    return this.serialize(async () => {
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
      if (!Array.isArray(records)) throw new DataError("invalid", "replaceAll takes a list of records");
      if (records.length > PLUGIN_DATA_LIMITS.records) throw this.tooMany();
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

  private tooMany(): DataError {
    return new DataError("invalid", `A collection holds at most ${PLUGIN_DATA_LIMITS.records} records`);
  }

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.writes.then(fn, fn);
    this.writes = run.catch(() => undefined);
    return run;
  }
}
