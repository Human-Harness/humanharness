import path from "node:path";
import type { ActionStatus } from "@humanharness/ui/client";
import type { CurrentTask, TasksFile } from "./task-store";

/** What a lane reads and writes through: a `TaskStore` (or a test's memory). `file`, when given, keys the write chain. */
export type TasksFileStore = { load(): Promise<TasksFile>; save(state: TasksFile): Promise<void>; readonly file?: string };

/**
 * One write chain per tasks.json: by its resolved path when the store names one (two `TaskStore`s of one folder share
 * it), otherwise by the store object. Every load-merge-save runs after the one before it ended.
 */
const byPath = new Map<string, Promise<unknown>>();
const byStore = new WeakMap<TasksFileStore, Promise<unknown>>();

/**
 * Runs `fn` on `store` once every earlier write through it ended (failed ones too). Anything else that changes
 * a file lanes write (the board's `focus`) goes through here, so no read-modify-write undoes another.
 */
export function withTasksFile<T>(store: TasksFileStore, fn: () => Promise<T>): Promise<T> {
  const key = store.file === undefined ? undefined : path.resolve(store.file);
  const before = (key === undefined ? byStore.get(store) : byPath.get(key)) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const tail: Promise<unknown> = run.catch(() => {});
  if (key === undefined) byStore.set(store, tail);
  else {
    byPath.set(key, tail);
    // The map keeps a path only while a write is pending on it.
    void tail.then(() => {
      if (byPath.get(key) === tail) byPath.delete(key);
    });
  }
  return run;
}

/** How many distinct snapshots a lane keeps between two saves: reads repeat, so a bound on a long idle stretch. */
const SNAPSHOTS_MAX = 64;

/**
 * One lane's view of tasks.json (parallel spec §6, Decision 3): its task is `current`, the others are hidden. On save
 * its task goes back into `lanes` and its changes to the shared fields are merged three-way, so two lanes saving one
 * after the other never undo each other's action statuses.
 *
 * The merge base is every view this lane loaded since its last save: `TaskManager` reads outside its updates too, and
 * the state it saves may come from any of those reads. A value counts as this lane's change only when it differs
 * from all of them; anything else is left as the file has it now.
 */
export class LaneStore {
  /** Distinct views loaded (or saved) since the last save, oldest first. Empty: none yet. */
  private snapshots: TasksFile[] = [];

  constructor(
    private readonly file: TasksFileStore,
    readonly id: string,
  ) {}

  async load(): Promise<TasksFile> {
    const view = viewOf(await this.file.load(), this.id);
    this.remember(view);
    return view;
  }

  /**
   * Serialized with every other save to the same tasks.json. A `current` that isn't this lane's task is refused.
   * A lane the file no longer lists (another writer ended it) is not put back, unless this save starts its task.
   */
  save(state: TasksFile): Promise<void> {
    if (state.current && state.current.id !== this.id) {
      return Promise.reject(new Error(`Lane ${this.id} can't save task ${state.current.id}`));
    }
    return withTasksFile(this.file, async () => {
      const fresh = await this.file.load();
      const bases = this.snapshots.length > 0 ? this.snapshots : [viewOf(fresh, this.id)];
      const all = fresh.lanes ?? [];
      const at = all.findIndex((l) => l.id === this.id);
      const lanes = all.filter((l) => l.id !== this.id);
      const isNew = bases.every((b) => b.current === null);
      if (state.current && (at >= 0 || isNew)) lanes.splice(at < 0 ? lanes.length : at, 0, withBoardFields(state.current, all[at]));
      const { open: _open, engine: _engine, scopes: _scopes, ...rest } = fresh;
      const scopes = mergeScopes(bases.map((b) => b.scopes), state.scopes, fresh.scopes);
      const merged: TasksFile = {
        ...rest,
        ...mergeOptional("engine", bases, state, fresh),
        current: null,
        actions: mergeRecord(bases.map((b) => b.actions), state.actions, fresh.actions),
        ...mergeOptional("open", bases, state, fresh),
        ...(scopes ? { scopes } : {}),
        lanes,
      };
      await this.file.save(merged);
      this.snapshots = [structuredClone(state)];
    });
  }

  /**
   * The board's own fields of this lane's task (`tokens`, `conflict`): `fn` gets them as the file has them now, and
   * only they change. The rest of the task and the lane's merge base stay as they are. Nothing when the file no
   * longer lists the lane.
   */
  amend(fn: (fields: BoardFields) => BoardFields): Promise<void> {
    return withTasksFile(this.file, async () => {
      const fresh = await this.file.load();
      const lanes = fresh.lanes ?? [];
      const at = lanes.findIndex((l) => l.id === this.id);
      if (at < 0) return;
      const { tokens, conflict, ...task } = lanes[at];
      const next = fn({ ...(tokens !== undefined ? { tokens } : {}), ...(conflict !== undefined ? { conflict: [...conflict] } : {}) });
      const out = [...lanes];
      out[at] = { ...task, ...(next.tokens !== undefined ? { tokens: next.tokens } : {}), ...(next.conflict?.length ? { conflict: next.conflict } : {}) };
      await this.file.save({ ...fresh, lanes: out });
    });
  }

  private remember(view: TasksFile): void {
    const text = JSON.stringify(view);
    if (this.snapshots.some((s) => JSON.stringify(s) === text)) return;
    this.snapshots.push(structuredClone(view));
    // The oldest stays (the state an update started from is usually the first read); the next oldest goes.
    if (this.snapshots.length > SNAPSHOTS_MAX) this.snapshots.splice(1, 1);
  }
}

/** What the board keeps on a lane's task beside the task manager's state (parallel spec §9.1). */
export type BoardFields = Pick<CurrentTask, "tokens" | "conflict">;

/**
 * `task` as the lane saves it, with the board's fields as the file has them (`was`): only `amend` changes those, so a
 * task manager's save of a state read before an `amend` never undoes it.
 */
function withBoardFields(task: CurrentTask, was: CurrentTask | undefined): CurrentTask {
  const { tokens: _tokens, conflict: _conflict, ...own } = task;
  return { ...own, ...(was?.tokens !== undefined ? { tokens: was.tokens } : {}), ...(was?.conflict !== undefined ? { conflict: was.conflict } : {}) };
}

/** `f` as lane `id` sees it: its task as `current`, no `lanes` and no `focus`. */
function viewOf(f: TasksFile, id: string): TasksFile {
  const { lanes, focus: _focus, current: _current, ...rest } = f;
  return { ...rest, current: (lanes ?? []).find((l) => l.id === id) ?? null };
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Keys this lane changed (a value, or absence, unlike every base) applied to `fresh`. */
function mergeRecord<T>(bases: readonly Record<string, T>[], mine: Record<string, T>, fresh: Record<string, T>): Record<string, T> {
  const out = { ...fresh };
  const keys = new Set([...bases.flatMap((b) => Object.keys(b)), ...Object.keys(mine)]);
  for (const k of keys) {
    const after = Object.hasOwn(mine, k) ? mine[k] : undefined;
    if (bases.some((b) => same(Object.hasOwn(b, k) ? b[k] : undefined, after))) continue;
    if (after === undefined) delete out[k];
    else out[k] = after;
  }
  return out;
}

type Scopes = Record<string, Record<string, ActionStatus>>;

/**
 * Each scope merged as `actions` is. A scope this lane dropped loses only the keys it had; it goes when nothing
 * another lane added is left in it. Undefined when there is nothing to write.
 */
function mergeScopes(bases: readonly (Scopes | undefined)[], mine: Scopes | undefined, fresh: Scopes | undefined): Scopes | undefined {
  if (bases.every((b) => b === undefined) && mine === undefined) return fresh;
  const out: Scopes = { ...(fresh ?? {}) };
  const ids = new Set([...bases.flatMap((b) => Object.keys(b ?? {})), ...Object.keys(mine ?? {})]);
  for (const s of ids) {
    const before = bases.map((b) => (b && Object.hasOwn(b, s) ? b[s] : {}));
    const kept = mine !== undefined && Object.hasOwn(mine, s);
    const result = mergeRecord(before, kept ? mine[s] : {}, Object.hasOwn(out, s) ? out[s] : {});
    if (kept || Object.keys(result).length > 0) out[s] = result;
    else delete out[s];
  }
  return mine === undefined && fresh === undefined ? undefined : out;
}

/** This lane's value when it differs from every base (absent when it cleared it), otherwise the file's. */
function mergeOptional<K extends "open" | "engine">(key: K, bases: readonly TasksFile[], mine: TasksFile, fresh: TasksFile): Partial<Pick<TasksFile, K>> {
  const value = bases.some((b) => b[key] === mine[key]) ? fresh[key] : mine[key];
  return value === undefined ? {} : ({ [key]: value } as Partial<Pick<TasksFile, K>>);
}
