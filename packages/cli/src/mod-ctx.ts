// The parts of a mod's `ctx` that do nothing, without the app: `mod check`'s fake ctx (kit/check.ts) and `run`'s
// headless host (run-mods.ts) share them.
import type { Services } from "@humanharness/shell/tasks";

/** Every service a mod's ctx has, doing nothing; `storage` is kept in memory. `engineError`: why `engine.run` fails. */
export function noopServices(engineError: string) {
  const store = new Map<string, unknown>();
  return {
    engine: { run: async () => ({ ok: false, text: "", error: engineError }) },
    tasks: { running: async () => null },
    notes: { titles: async () => [] },
    storage: { get: async <T>(k: string) => store.get(k) as T | undefined, set: async (k: string, v: unknown) => void store.set(k, v) },
    stores: { open: (name: string) => ({ name, readAll: async () => [], write: async () => undefined }) },
    usage: { record: async () => undefined, summary: async () => ({ week: 0 }) },
    dataDir: async (): Promise<string | null> => null,
    notify: () => undefined,
    log: (..._args: unknown[]): void => undefined,
  } satisfies Services;
}
