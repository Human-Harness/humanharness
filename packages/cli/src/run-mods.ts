// The mods in `humanharness run`: those that are on, loaded headless by the app's own host, for their `instructions()`
// and `agentTools()` only. A mod's ctx here has those two hooks, `config`, `log`, `dataDir` and `tasks.running` live;
// the rest does nothing (no other hook is ever called, and there is no `ctx.app`).
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { LoadedHarness } from "@humanharness/harness-sdk";
import type { TaskRef } from "@humanharness/mod-sdk";
import { MAIN_SHARED_MODULES } from "@humanharness/mod-sdk/bundle";
import { CORE_MOD_SWITCHES, ModHost, type ResolvedMod, resolveMods } from "@humanharness/shell/tasks";
import { coreModsDir } from "./kit/harness-project";
import { noopServices } from "./mod-ctx";
import { CORE_DIR, shellDir } from "./paths";

export type CoreModSources = Record<string, { dir: string; on?: boolean }>;

/**
 * The core's mods as `run` loads them, each with the app's default switch: its package in the checkout (dev, the same
 * source as the CLI's own), else the app build's copy in `out/core-mods/`.
 */
export function runCoreMods(packages = coreModsDir(CORE_DIR), built = path.join(shellDir(), "out", "core-mods")): CoreModSources {
  return Object.fromEntries(
    Object.entries(CORE_MOD_SWITCHES).map(([id, mod]) => {
      const own = path.join(packages, id);
      return [id, { ...mod, dir: existsSync(path.join(own, "mod.json")) ? own : path.join(built, id) }];
    }),
  );
}

/** A core mod's package has no built main: its `mod.json`'s `main.js` is its `src/main.ts` (or `.tsx`). */
export function fromSource(mod: ResolvedMod): ResolvedMod {
  const main = mod.json.main;
  if (mod.shipped !== "core" || main === undefined || existsSync(path.join(mod.dir, main))) return mod;
  const stem = path.basename(main).replace(/\.m?js$/, "");
  const source = [".ts", ".tsx"].map((ext) => `src/${stem}${ext}`).find((file) => existsSync(path.join(mod.dir, file)));
  return source ? { ...mod, json: { ...mod.json, main: source } } : mod;
}

export interface RunModsOptions {
  harness: LoadedHarness;
  /** The run's work folder: a mod's `dataDir` is in it. */
  folder: string;
  /** One line for the person: a mod that didn't load, or was turned off. */
  warn: (text: string) => void;
  /** The run's open task (`ctx.tasks.running`); without, none. */
  running?: () => Promise<TaskRef | null>;
  /** Tests: the core mods to resolve, instead of `runCoreMods`. */
  coreMods?: CoreModSources;
}

/**
 * Loads the mods on for `run`: the app's rules with no person's choices (the harness's declared ones, and the core
 * mods on by default). A mod that can't load is one warning; the run goes on without it.
 */
export async function startRunMods({ harness, folder, warn, running, coreMods = runCoreMods() }: RunModsOptions): Promise<ModHost> {
  // A built core main reads the shared imports from here, as in the app.
  const g = globalThis as { __hhMainModules?: Record<string, Record<string, unknown>> };
  g.__hhMainModules = { ...g.__hhMainModules, ...MAIN_SHARED_MODULES };
  const { mods, problems } = await resolveMods({ declared: harness.mods, harnessModsDir: path.join(harness.root, "mods"), local: [], core: coreMods });
  const host = new ModHost({
    config: { load: async () => undefined, saveFailed: async () => undefined },
    services: (id) => ({
      ...noopServices("`humanharness run` runs no engine for a mod"),
      ...(running ? { tasks: { running } } : {}),
      dataDir: async () => {
        const dir = path.join(folder, ".harness", "mods", id);
        await fs.mkdir(dir, { recursive: true });
        return dir;
      },
      // stderr: the run's output is the task's.
      log: (...args: unknown[]) => console.error(`[mod ${id}]`, ...args),
    }),
    notice: warn,
    changed: () => undefined,
    coreOn: (id) => coreMods[id]?.on === true,
  });
  await host.start(mods.map(fromSource));
  const broken = host.view().flatMap((m) => (m.problem ? [{ id: m.id, reason: m.problem }] : []));
  for (const { id, reason } of [...problems, ...broken]) warn(`the mod "${id}" did not load: ${reason.replace(/\s+/g, " ")}`);
  return host;
}
