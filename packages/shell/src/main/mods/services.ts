import { promises as fs } from "node:fs";
import path from "node:path";
import { collectionSchema } from "@humanharness/harness-sdk";
import type { EngineRunResult, ModStore, TaskRef, Tier, UsageEntry, UsageSummary } from "@humanharness/mod-sdk";
import type { TurnUsage } from "@humanharness/protocol";
import { APP_SCOPE, DATA_CHANGE_PREFIX, DataStore, dataPath, dataRequestSchema, runDataRequest } from "@humanharness/workspace";
import { type SidekickUsageMoment, type UsageRecord, UsageLog, capTokens, dayTokens, recentUsage } from "../usage-log";
import { localDay } from "./host";
import type { Services } from "./host";

/** The app's home folder (spec §5.1). 0a only uses `storage/` and `sessions/`; 0b lands the rest. */
export const appHome = (userData: string, harnessId: string) => path.join(userData, harnessId, "app");

/** Work-folder history ignores for mod data (spec §4.1). */
export const modHistoryIgnores = (mods: { id: string; history: boolean }[]) => mods.filter((m) => !m.history).map((m) => `.harness/mods/${m.id}/`);

export interface ServiceDeps {
  harnessId: string;
  userData: string;
  /** The work folder, or null before setup. */
  base(): Promise<string | null>;
  /** One tool-less turn on a tier; `process` tags the usage line. index.ts builds it on SidekickSession. */
  engineRun(r: { process: string; tier: Tier; prompt: string; workDir: string; signal?: AbortSignal }): Promise<EngineRunResult>;
  runningTask(): Promise<TaskRef | null>;
  noteTitles(scope?: string): Promise<string[]>;
  notify(text: string): void;
  /**
   * A mod store's writes: why none may run now (a switch, restore or quit holds turns), and the history commit of the
   * paths it changed. Absent: writes are refused / not committed.
   */
  data?: { blocked(): string | null; commit(base: string, paths: string[], message: string): Promise<void> };
}

/**
 * Core mods that were core code before keep their usage lines' `phase` and `process`, so Settings › Usage and the
 * daily card count them as before (`sidekick`); every other mod's lines are `phase: "mod"`, `process: "mod:<id>"`.
 */
const LEGACY_USAGE: ReadonlySet<string> = new Set(["sidekick"]);
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const allTokens = (u: TurnUsage) => u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens;
const isTokens = (u: unknown): u is TurnUsage =>
  typeof u === "object" && u !== null && ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"].every((k) => Number.isFinite((u as Record<string, unknown>)[k]));
const str = (v: unknown, max = 200) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : undefined);

/** A usage line for a mod's own turn: only known fields, each checked. */
export function modUsageRecord(id: string, kind: string, e: UsageEntry, at: string = new Date().toISOString()): UsageRecord {
  const legacy = LEGACY_USAGE.has(id);
  const fields = { action: str(e.action), task: str(e.task), scope: str(e.scope), tier: str(e.tier, 20), model: str(e.model), effort: str(e.effort, 20) };
  return {
    at,
    engine: str(e.engine, 40) ?? "unknown",
    ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    phase: legacy ? "sidekick" : "mod",
    process: legacy ? "sidekick" : `mod:${id}`,
    moment: (str(kind, 80) ?? "turn") as SidekickUsageMoment,
    ...(legacy && str(e.by) ? { sidekick: str(e.by) } : {}),
    ok: e.ok === true,
    ...(isTokens(e.usage) ? { usage: e.usage } : {}),
    ...(Array.isArray(e.limits) ? { limits: e.limits as UsageRecord["limits"] } : {}),
  } as UsageRecord;
}

/** What a mod spent, from the usage lines: its own for `task` and the last 7 days, and a local day's. */
export function modUsageSummary(id: string, records: UsageRecord[], o: { task?: string; day?: string } = {}, now: Date = new Date()): UsageSummary {
  const process = LEGACY_USAGE.has(id) ? "sidekick" : `mod:${id}`;
  const own = records.filter((r) => r.process === process && r.usage);
  const since = now.getTime() - WEEK_MS;
  const sum = (xs: UsageRecord[], f: (u: TurnUsage) => number) => xs.reduce((n, r) => n + f(r.usage!), 0);
  return {
    week: sum(own.filter((r) => Date.parse(r.at) >= since), allTokens),
    ...(o.task !== undefined ? { task: sum(own.filter((r) => r.task === o.task), capTokens) } : {}),
    ...(o.day !== undefined ? { day: { tasks: dayTokens(records, o.day, localDay).tasks, mod: sum(own.filter((r) => localDay(new Date(r.at)) === o.day), capTokens) } } : {}),
  };
}

/** A store's name: the mod's id, or `<id>-<more>`; never a harness collection's. */
const storeName = (id: string, name: string) => name === id || (name.startsWith(`${id}-`) && /^[a-z][a-z0-9-]{0,63}$/.test(name));

function modStores(id: string, d: ServiceDeps): Services["stores"] {
  // One DataStore per base and name: a profile switch or a move reads the new base's file.
  const cache = new Map<string, DataStore>();
  return {
    open: (name, collection) => {
      if (!storeName(id, name)) throw new Error(`A mod's store is named "${id}" or "${id}-…", not "${name}"`);
      const def = collectionSchema.parse(collection);
      const storeOf = (base: string) => {
        const key = `${base}\0${name}`;
        let st = cache.get(key);
        if (!st) cache.set(key, (st = new DataStore(base, { [name]: def })));
        return st;
      };
      const store: ModStore = {
        name,
        readAll: async () => {
          const base = await d.base();
          return base ? ((await storeOf(base).readAll(name, APP_SCOPE)).records as Record<string, unknown>[]) : [];
        },
        write: async (requests) => {
          if (!d.data) throw new Error("This app can't write a mod's data");
          const blocked = d.data.blocked();
          if (blocked) throw new Error(blocked);
          const base = await d.base();
          if (!base) throw new Error("The app is not set up yet");
          // Every request checked before any runs, so a malformed one writes nothing.
          for (const r of requests) {
            const p = dataRequestSchema.safeParse(r);
            if (!p.success || p.data.collection !== name) throw new Error(`Not a data request on ${name}`);
          }
          const st = storeOf(base);
          for (const r of requests) await runDataRequest(st, r, { who: "app", scope: APP_SCOPE });
          await d.data.commit(base, [dataPath(st.scopeFor(name, APP_SCOPE), name)], `${DATA_CHANGE_PREFIX}${name}`);
        },
      };
      return store;
    },
  };
}

/** The services each mod's ctx gets, by mod id. */
export function buildServices(d: ServiceDeps): (id: string) => Services {
  return (id) => {
    const file = path.join(appHome(d.userData, d.harnessId), "storage", `${id}.json`);
    const read = async (): Promise<Record<string, unknown>> => {
      try {
        return JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    // Writes run one after another, each atomic (temp file + rename).
    let queue: Promise<unknown> = Promise.resolve();
    return {
      storage: {
        get: async <T>(key: string) => (await read())[key] as T | undefined,
        set: (key, value) => {
          const next = queue.then(async () => {
            const all = await read();
            all[key] = value;
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(`${file}.tmp`, JSON.stringify(all));
            await fs.rename(`${file}.tmp`, file);
          });
          queue = next.catch(() => undefined);
          return next;
        },
      },
      dataDir: async () => {
        const base = await d.base();
        if (!base) return null;
        const dir = path.join(base, ".harness", "mods", id);
        await fs.mkdir(dir, { recursive: true });
        return dir;
      },
      engine: {
        run: (tier, prompt, opts) =>
          d.engineRun({ process: `mod:${id}`, tier, prompt, workDir: path.join(appHome(d.userData, d.harnessId), "sessions", id), ...(opts?.signal ? { signal: opts.signal } : {}) }),
      },
      tasks: { running: () => d.runningTask() },
      notes: { titles: (scope) => d.noteTitles(scope) },
      notify: (text) => d.notify(text),
      stores: modStores(id, d),
      usage: {
        record: async (kind, entry) => {
          const base = await d.base();
          if (base) await new UsageLog(base).append(modUsageRecord(id, kind, entry));
        },
        summary: async (o) => {
          const base = await d.base();
          return modUsageSummary(id, base ? recentUsage(await new UsageLog(base).load(Infinity), 2000) : [], o);
        },
      },
      log: (...args) => console.log(`[mod ${id}]`, ...args),
    };
  };
}
