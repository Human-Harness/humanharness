import type { ActionStatus } from "@humanharness/ui/client";
import type { TasksFile } from "./task-store";

/** What a lane reads and writes through: the board's one `TaskStore` (or a test's memory). */
export type TasksFileStore = { load(): Promise<TasksFile>; save(state: TasksFile): Promise<void> };

/** One write chain per file store: every lane's load-merge-save runs after the one before it ended. */
const chains = new WeakMap<TasksFileStore, Promise<unknown>>();

/**
 * Runs `fn` on `store` once every earlier write through it ended (failed ones too). Anything else that changes
 * a file lanes write (the board's `focus`) goes through here, so no read-modify-write undoes another.
 */
export function withTasksFile<T>(store: TasksFileStore, fn: () => Promise<T>): Promise<T> {
  const run = (chains.get(store) ?? Promise.resolve()).then(fn, fn);
  chains.set(store, run.catch(() => {}));
  return run;
}

/**
 * One lane's view of tasks.json (parallel spec §6, Decision 3): its task is `current`, the others are hidden. On save
 * its task goes back into `lanes` and its changes to the shared fields are merged three-way against what it loaded,
 * so two lanes saving one after the other never undo each other's action statuses.
 */
export class LaneStore {
  /** What this lane last loaded or saved: the base of the next merge. */
  private base: TasksFile | null = null;

  constructor(
    private readonly file: TasksFileStore,
    readonly id: string,
  ) {}

  async load(): Promise<TasksFile> {
    const view = viewOf(await this.file.load(), this.id);
    this.base = structuredClone(view);
    return view;
  }

  /** Serialized with every other save to the same file store. A task other than this lane's is never written. */
  save(state: TasksFile): Promise<void> {
    return withTasksFile(this.file, async () => {
      const fresh = await this.file.load();
      const base = this.base ?? viewOf(fresh, this.id);
      const all = fresh.lanes ?? [];
      const at = all.findIndex((l) => l.id === this.id);
      const lanes = all.filter((l) => l.id !== this.id);
      if (state.current && state.current.id === this.id) lanes.splice(at < 0 ? lanes.length : at, 0, state.current);
      const { open: _open, engine: _engine, scopes: _scopes, ...rest } = fresh;
      const scopes = mergeScopes(base.scopes, state.scopes, fresh.scopes);
      const merged: TasksFile = {
        ...rest,
        ...mergeOptional("engine", base, state, fresh),
        current: null,
        actions: mergeRecord(base.actions, state.actions, fresh.actions),
        ...mergeOptional("open", base, state, fresh),
        ...(scopes ? { scopes } : {}),
        lanes,
      };
      await this.file.save(merged);
      this.base = structuredClone(state);
    });
  }
}

/** `f` as lane `id` sees it: its task as `current`, no `lanes` and no `focus`. */
function viewOf(f: TasksFile, id: string): TasksFile {
  const { lanes, focus: _focus, current: _current, ...rest } = f;
  return { ...rest, current: (lanes ?? []).find((l) => l.id === id) ?? null };
}

/** Keys this lane changed (added, changed or removed against `base`) applied to `fresh`. */
function mergeRecord<T>(base: Record<string, T>, mine: Record<string, T>, fresh: Record<string, T>): Record<string, T> {
  const out = { ...fresh };
  for (const k of new Set([...Object.keys(base), ...Object.keys(mine)])) {
    const before = Object.hasOwn(base, k) ? base[k] : undefined;
    const after = Object.hasOwn(mine, k) ? mine[k] : undefined;
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    if (after === undefined) delete out[k];
    else out[k] = after;
  }
  return out;
}

type Scopes = Record<string, Record<string, ActionStatus>>;

/** Each scope merged as `actions` is; a scope this lane removed is removed. Undefined when none is left to write. */
function mergeScopes(base: Scopes | undefined, mine: Scopes | undefined, fresh: Scopes | undefined): Scopes | undefined {
  if (!base && !mine) return fresh;
  const out: Scopes = { ...(fresh ?? {}) };
  for (const s of new Set([...Object.keys(base ?? {}), ...Object.keys(mine ?? {})])) {
    const had = base !== undefined && Object.hasOwn(base, s);
    if (!mine || !Object.hasOwn(mine, s)) {
      if (had) delete out[s];
      continue;
    }
    out[s] = mergeRecord(had ? base[s] : {}, mine[s], Object.hasOwn(out, s) ? out[s] : {});
  }
  return mine === undefined && fresh === undefined ? undefined : out;
}

/** This lane's value when it changed it (absent when it cleared it), otherwise the file's. */
function mergeOptional<K extends "open" | "engine">(key: K, base: TasksFile, mine: TasksFile, fresh: TasksFile): Partial<Pick<TasksFile, K>> {
  const value = base[key] === mine[key] ? fresh[key] : mine[key];
  return value === undefined ? {} : ({ [key]: value } as Partial<Pick<TasksFile, K>>);
}
