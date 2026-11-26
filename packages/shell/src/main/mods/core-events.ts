import type { ModHost } from "./host";

type Off = () => void;
type HostEvents = Partial<Pick<ModHost, "dataChanged" | "restored" | "baseGone">>;

/** What the app's call sites say happened; the core mods (via the host) and the core's own services hear it. */
export interface CoreEvents {
  /** The base's data changed: a write to the harness's collection `collection`, or a plugin's data or on/off (null). */
  dataChanged(collection: string | null): void;
  /** A history restore touched `paths` (base-relative); null: it reconciled the whole folder. */
  restored(paths: readonly string[] | null): void;
  /** `base` is gone for good: a folder move left it, or a profile was forgotten. Resolves when the listeners are done. */
  baseGone(base: string): Promise<void>;
  /** Before quit: the core's own services settle. (A core mod hears the host's `close` hook as it stops.) */
  closing(): Promise<void>;
  /** The core's own services subscribe here (a core mod uses `ctx.on` instead). */
  readonly on: {
    dataChanged(fn: (collection: string | null) => void): Off;
    restored(fn: (paths: readonly string[] | null) => void): Off;
    baseGone(fn: (base: string) => void | Promise<void>): Off;
    closing(fn: () => void | Promise<void>): Off;
  };
}

/**
 * The events the core emits from its existing call sites (data writes, restores, folder moves, profile deletes, quit),
 * fanned out to the shell's own subscribers and to the core mods through the mod host. A listener that throws never
 * reaches the call site. D0: with no listener and no host, nothing happens.
 */
export function createCoreEvents(d: { host(): HostEvents | null }): CoreEvents {
  const lists = {
    dataChanged: new Set<(c: string | null) => void>(),
    restored: new Set<(p: readonly string[] | null) => void>(),
    baseGone: new Set<(b: string) => void | Promise<void>>(),
    closing: new Set<() => void | Promise<void>>(),
  };
  const sub =
    <F>(set: Set<F>) =>
    (fn: F): Off => {
      set.add(fn);
      return () => void set.delete(fn);
    };
  const log = (what: string, err: unknown) => console.error(`A ${what} listener failed`, err);
  const hostCall = (call: (h: HostEvents) => Promise<void> | undefined): Promise<void> => {
    const h = d.host();
    return h ? Promise.resolve(call(h)).catch((err: unknown) => log("mod", err)) : Promise.resolve();
  };
  const settle = async (fns: Iterable<() => void | Promise<void>>, what: string): Promise<void> => {
    await Promise.all([...fns].map((fn) => Promise.resolve().then(fn).catch((err: unknown) => log(what, err))));
  };
  const sync = <A extends unknown[]>(set: Set<(...a: A) => void>, what: string, ...args: A) => {
    for (const fn of [...set]) {
      try {
        fn(...args);
      } catch (err) {
        log(what, err);
      }
    }
  };
  return {
    dataChanged(collection) {
      sync(lists.dataChanged, "dataChanged", collection);
      void hostCall((h) => h.dataChanged?.(collection));
    },
    restored(paths) {
      sync(lists.restored, "restored", paths);
      void hostCall((h) => h.restored?.(paths));
    },
    async baseGone(base) {
      await Promise.all([settle([...lists.baseGone].map((fn) => () => fn(base)), "baseGone"), hostCall((h) => h.baseGone?.(base))]);
    },
    closing: () => settle(lists.closing, "closing"),
    on: { dataChanged: sub(lists.dataChanged), restored: sub(lists.restored), baseGone: sub(lists.baseGone), closing: sub(lists.closing) },
  };
}
