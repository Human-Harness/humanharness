import type { HarnessClient, ModRow, ModsView } from "../client";
import type { BlockComponent, BlockRegistry, ComposerReviewer, RowOptions, RowPlace, SettingsTabOptions, Slots, TaskPageOptions } from "./registry";

/** What a mod's `ui` part gets (mod-sdk's `UiCtx`): its id, the way to register a block, and its own main's names. */
export interface UiCtx {
  readonly id: string;
  block(name: string, component: unknown): () => void;
  /** Calls `name` on the mod's own main; rejects when the mod is off or has no such name. */
  call(name: string, payload?: unknown): Promise<unknown>;
  /** Hears the mod's own main's `ctx.push(name, value)`. */
  on(name: string, fn: (value: unknown) => void): () => void;
  /** A tab in Settings, right after Models; its id is `name`; `o.shown` and `o.useLabel` say when it shows and its name. */
  settingsTab(name: string, component: unknown, o: SettingsTabOptions): () => void;
  /** A row in Settings › Models (after the core's task rows) or Settings › Usage (after the core's lines). */
  row(place: RowPlace, component: unknown, o?: RowOptions): () => void;
  /** A piece in the task bar, after the core's. */
  taskBar(component: unknown): () => void;
  /** A right overlay of the open task, opened by `button` in the task bar (none in a narrow window). */
  taskOverlay(o: { name: string; button: unknown; panel: unknown; bare?: boolean }): () => void;
  /** Reviews the composer's and the answer form's sends before they go. */
  composer(reviewer: ComposerReviewer): () => void;
  /** A page of the task view (once per mod): a rail entry and a page that takes the work screen. */
  taskPage(o: TaskPageOptions & { page: unknown }): () => void;
}
/** A built `ui.js`: its default export is the mod's definition. */
export interface ModModule {
  default?: { ui?(ctx: UiCtx): void };
}
/** A core mod whose ui ships with the window (its definition, imported by the window itself). */
export interface WindowMod {
  readonly id: string;
  ui?(ctx: UiCtx): void;
}

export interface ModLoaderOptions {
  client: { mods: Pick<HarnessClient["mods"], "view" | "onChanged" | "onReloaded" | "call" | "on"> };
  registry: BlockRegistry;
  /** Imports a mod's built ui; the window's own `import()` unless a test gives a fake. */
  importer?: (url: string) => Promise<ModModule>;
  /** The window's core mods: their ui runs once, at start, with the same ctx (main says whether each is on). */
  core?: readonly WindowMod[];
  log?: (...args: unknown[]) => void;
}

export interface ModLoader {
  /** Resolves once every change seen so far has been applied. */
  settled(): Promise<void>;
  /** Takes every block and listener away and stops listening. */
  stop(): void;
}

const windowImport = (url: string): Promise<ModModule> => import(/* @vite-ignore */ url) as Promise<ModModule>;

/** A row whose ui the window runs: on, not a core mod (the core's ui ships with the window) and with a `ui` part. */
const runs = (r: ModRow) => r.on && r.origin !== "core" && r.ui === true;

type Mods = ModLoaderOptions["client"]["mods"];

/**
 * One run of a mod's `ui(ctx)`: what it registered is collected until `attach` (a `ui()` that throws halfway
 * registers nothing), live from then on, and all gone at `dispose`. `call` and `on` are bound to the mod's id: a ui
 * never reaches another mod's names.
 */
function uiRun(id: string, mods: Mods, registry: BlockRegistry) {
  type Entry = { attach(): () => void; off?: () => void; gone?: boolean };
  const entries: Entry[] = [];
  let live = false;
  let dead = false;
  let taskPages = 0;
  const add = (attach: () => () => void): (() => void) => {
    const e: Entry = { attach };
    if (dead) return () => {};
    entries.push(e);
    if (live) e.off = attach();
    return () => {
      e.gone = true;
      e.off?.();
      delete e.off;
    };
  };
  const slot = <K extends keyof Slots>(kind: K, entry: Slots[K]) => add(() => registry.add(kind, entry));
  const ctx: UiCtx = {
    id,
    block: (name, component) => add(() => registry.register(id, name, component as BlockComponent)),
    settingsTab: (name, component, o) =>
      slot("settingsTab", {
        mod: id,
        name,
        label: o.label,
        ...(o.shown ? { shown: o.shown } : {}),
        ...(o.useLabel ? { useLabel: o.useLabel } : {}),
        Component: component as Slots["settingsTab"]["Component"],
      }),
    row: (place, component, o) => {
      if (place !== "models" && place !== "usage") throw new Error(`Mod ${id}: no row place "${String(place)}" (models, usage)`);
      return slot("row", { mod: id, place, ...(o?.shown ? { shown: o.shown } : {}), Component: component as Slots["row"]["Component"] });
    },
    taskBar: (component) => slot("taskBar", { mod: id, Component: component as Slots["taskBar"]["Component"] }),
    taskOverlay: (o) =>
      slot("taskOverlay", { mod: id, name: o.name, Button: o.button as Slots["taskOverlay"]["Button"], Panel: o.panel as Slots["taskOverlay"]["Panel"], ...(o.bare ? { bare: true } : {}) }),
    composer: (reviewer) => slot("composer", { mod: id, reviewer }),
    taskPage: (o) => {
      if (taskPages > 0) throw new Error(`Mod ${id}: a mod registers a task page once`);
      taskPages += 1;
      const off = slot("taskPage", { mod: id, name: o.name, rail: o.rail, title: o.title, Page: o.page as Slots["taskPage"]["Page"] });
      return () => {
        off();
        taskPages = 0;
      };
    },
    call: (name, payload) => mods.call(id, name, payload),
    on: (name, fn) => add(() => mods.on(id, name, fn)),
  };
  return {
    ctx,
    attach() {
      live = true;
      for (const e of entries) if (!e.gone && !e.off) e.off = e.attach();
    },
    dispose() {
      dead = true;
      for (const e of entries.splice(0)) {
        e.gone = true;
        e.off?.();
      }
    },
  };
}

/**
 * Runs the `ui` part of every on, non-core mod (minimal-core 0b2): imports `hh-mod://<id>/ui.js` and calls its
 * default `ui(ctx)`, whose blocks go into `registry`. A reload (`hh:modReloaded`) or a new version imports it again and
 * swaps the blocks; a failed import or a throwing `ui()` leaves the blocks it had and logs. A mod turned off or gone
 * loses its blocks (the layout then says it is off) and its listeners. The window's core mods (`core`) run once.
 */
export function startModLoader({ client, registry, importer = windowImport, core = [], log = console.error }: ModLoaderOptions): ModLoader {
  /** What each mod's ui registered, and which import (`<version>-<reloads>`) it came from. */
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

  /** Runs `ui`; true when it ran (and replaced what the mod had before). */
  const run = (id: string, key: string, ui: ((ctx: UiCtx) => void) | undefined): boolean => {
    const r = uiRun(id, client.mods, registry);
    try {
      ui?.(r.ctx);
    } catch (err) {
      r.dispose();
      log(`Mod ${id}: its ui threw`, err);
      return false;
    }
    drop(id);
    r.attach();
    loaded.set(id, { key, dispose: r.dispose });
    return true;
  };

  /** The core mods' ui, under a key no row has: `sync` never touches them. */
  const coreIds = new Set(core.map((m) => m.id));
  for (const m of core) run(m.id, "core", m.ui?.bind(m));

  const load = async (r: ModRow, key: string) => {
    let mod: ModModule;
    try {
      mod = await importer(`hh-mod://${r.id}/ui.js?v=${encodeURIComponent(key)}`);
    } catch (err) {
      log(`Mod ${r.id}: its ui could not be loaded`, err);
      return;
    }
    if (stopped) return;
    const def = mod.default;
    run(r.id, key, def?.ui ? (ctx) => def.ui?.(ctx) : undefined);
  };

  const sync = async () => {
    const wanted = new Map(rows.filter((r) => runs(r) && !coreIds.has(r.id)).map((r) => [r.id, r]));
    for (const id of [...loaded.keys()]) if (!wanted.has(id) && !coreIds.has(id)) drop(id);
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
