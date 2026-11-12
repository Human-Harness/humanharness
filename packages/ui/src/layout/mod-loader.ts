import type { HarnessClient, ModRow, ModsView } from "../client";
import type { BlockComponent, BlockRegistry } from "./registry";

/** What a mod's `ui` part gets (mod-sdk's `UiCtx`): its id and the way to register a block. */
export interface UiCtx {
  readonly id: string;
  block(name: string, component: unknown): () => void;
}
/** A built `ui.js`: its default export is the mod's definition. */
export interface ModModule {
  default?: { ui?(ctx: UiCtx): void };
}

export interface ModLoaderOptions {
  client: { mods: Pick<HarnessClient["mods"], "view" | "onChanged" | "onReloaded"> };
  registry: BlockRegistry;
  /** Imports a mod's built ui; the window's own `import()` unless a test gives a fake. */
  importer?: (url: string) => Promise<ModModule>;
  log?: (...args: unknown[]) => void;
}

export interface ModLoader {
  /** Resolves once every change seen so far has been applied. */
  settled(): Promise<void>;
  /** Takes every block away and stops listening. */
  stop(): void;
}

const windowImport = (url: string): Promise<ModModule> => import(/* @vite-ignore */ url) as Promise<ModModule>;

/** A row whose ui the window runs: on, not a core mod (the core's ui ships with the window) and with a `ui` part. */
const runs = (r: ModRow) => r.on && r.origin !== "core" && r.ui === true;

/**
 * Runs the `ui` part of every on, non-core mod (minimal-core 0b2): imports `hh-mod://<id>/ui.js` and calls its
 * default `ui(ctx)`, whose blocks go into `registry`. A reload (`hh:modReloaded`) or a new version imports it again and
 * swaps the blocks; a failed import or a throwing `ui()` leaves the blocks it had and logs. A mod turned off or gone
 * loses its blocks (the layout then says it is off).
 */
export function startModLoader({ client, registry, importer = windowImport, log = console.error }: ModLoaderOptions): ModLoader {
  /** The blocks each mod registered, and which import (`<version>-<reloads>`) they came from. */
  const loaded = new Map<string, { key: string; dispose: () => void }>();
  /** How many times main reloaded each mod, as its last `hh:modReloaded` said. */
  const reloads = new Map<string, number>();
  let rows: ModRow[] = [];
  let stopped = false;
  /** Every change runs after the one before: the blocks always match the last change. */
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (job: () => Promise<void>) => {
    queue = queue.then(job).catch((err: unknown) => log("Mod loader", err));
  };

  const keyOf = (r: ModRow) => `${r.version}-${reloads.get(r.id) ?? 0}`;

  const drop = (id: string) => {
    loaded.get(id)?.dispose();
    loaded.delete(id);
  };

  const load = async (r: ModRow, key: string) => {
    let mod: ModModule;
    try {
      mod = await importer(`hh-mod://${r.id}/ui.js?v=${encodeURIComponent(key)}`);
    } catch (err) {
      log(`Mod ${r.id}: its ui could not be loaded`, err);
      return;
    }
    if (stopped) return;
    // Collected first: a ui() that throws halfway registers nothing, and the old blocks stay.
    const entries: { name: string; component: BlockComponent; gone?: boolean; off?: () => void }[] = [];
    const ctx: UiCtx = {
      id: r.id,
      block(name, component) {
        const e = { name, component: component as BlockComponent } as (typeof entries)[number];
        entries.push(e);
        return () => {
          e.gone = true;
          e.off?.();
        };
      },
    };
    try {
      mod.default?.ui?.(ctx);
    } catch (err) {
      log(`Mod ${r.id}: its ui threw`, err);
      return;
    }
    drop(r.id);
    for (const e of entries) if (!e.gone) e.off = registry.register(r.id, e.name, e.component);
    loaded.set(r.id, {
      key,
      dispose: () => {
        for (const e of entries) {
          e.gone = true;
          e.off?.();
        }
      },
    });
  };

  const sync = async () => {
    const wanted = new Map(rows.filter(runs).map((r) => [r.id, r]));
    for (const id of [...loaded.keys()]) if (!wanted.has(id)) drop(id);
    for (const r of wanted.values()) {
      const key = keyOf(r);
      if (loaded.get(r.id)?.key !== key) await load(r, key);
      if (stopped) return;
    }
  };

  const changed = (v: ModsView) => {
    if (stopped) return;
    rows = v.mods;
    enqueue(sync);
  };

  let pushed = false;
  const offChanged = client.mods.onChanged((v) => {
    pushed = true;
    changed(v);
  });
  const offReloaded = client.mods.onReloaded(({ id, version }) => {
    if (stopped) return;
    reloads.set(id, version);
    enqueue(sync);
  });
  enqueue(async () => {
    try {
      const v = await client.mods.view();
      if (!pushed) changed(v);
    } catch (err) {
      log("Mod loader: could not read the mods", err);
    }
  });

  return {
    settled: async () => {
      // A job may enqueue another (the first read): wait until the queue stops growing.
      let last: Promise<void> | undefined;
      while (last !== queue) {
        last = queue;
        await last;
      }
    },
    stop() {
      stopped = true;
      offChanged();
      offReloaded();
      for (const id of [...loaded.keys()]) drop(id);
    },
  };
}
