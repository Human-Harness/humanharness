import { promises as fs } from "node:fs";
import path from "node:path";
import type { EngineRunResult, TaskRef, Tier } from "@humanharness/mod-sdk";
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
      log: (...args) => console.log(`[mod ${id}]`, ...args),
    };
  };
}
