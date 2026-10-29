// No imports: a plugin's bundle includes this file (plugins spec §3, Decision 1).

/** What a refused broker call throws (plugins spec §4.2); `name` is "PluginRefused". */
export interface PluginRefusedError extends Error {
  name: "PluginRefused";
}

export interface PluginResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Record<string, string>;
  text(): string;
  json(): unknown;
}

export interface PluginRecord {
  [field: string]: unknown;
}

export type PluginSeverity = "info" | "warn" | "action";

/** What a source gets: every call goes to the core's broker, which checks it against the approved permissions. */
export interface PluginContext {
  fetch(url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }): Promise<PluginResponse>;
  exec(cmd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
  data: {
    get(collection: string, key?: string | number): Promise<PluginRecord | null>;
    query(collection: string, q?: { where?: Record<string, unknown>; fields?: string[]; limit?: number }): Promise<{ records: PluginRecord[]; total: number }>;
    put(collection: string, record: PluginRecord): Promise<void>;
    patch(collection: string, key: string | number | undefined, patch: PluginRecord): Promise<void>;
    delete(collection: string, key?: string | number): Promise<void>;
    replaceAll(collection: string, records: PluginRecord[]): Promise<void>;
  };
  settings: { get(): Promise<Record<string, unknown>> };
  attention: {
    raise(item: {
      key: string;
      severity: PluginSeverity;
      title: string;
      body?: string;
      target?: { panel: string; focus?: string } | { action: string; vars?: Record<string, unknown> };
    }): Promise<void>;
    resolve(key: string): Promise<void>;
  };
  chip: { set(id: string, chip: { text: string; severity?: PluginSeverity }): Promise<void>; clear(id: string): Promise<void> };
  log(level: "info" | "warn" | "error", message: string): Promise<void>;
}

/** A backend: one function per source declared in plugin.json. */
export interface PluginBackend {
  sources: Record<string, (ctx: PluginContext) => Promise<void>>;
}

/** The backend module's default export (plugins spec §4.1). */
export const definePluginBackend = <T extends PluginBackend>(backend: T): T => backend;
