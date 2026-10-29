import { SETTINGS_COLLECTION, SIDEKICK_COLLECTION } from "@humanharness/harness-sdk";
import { APP_SCOPE, type CommitTrailer, DATA_CHANGE_PREFIX, DataError, type DataStore, type HistoryTrailer, dataPath, isDataWrite, isScopeDir, runDataRequest } from "@humanharness/workspace";
import { saveAppChange } from "./app-change";

/** The request can't run now (the app isn't set up, turns are blocked); its message is safe to show. */
export class DataUnavailable extends Error {}

/** Where a person's write is recorded: the folder's history. */
export interface DataHistory {
  save(message: string, trailer?: CommitTrailer): Promise<unknown>;
  /** Board mode's commit of the collection's file alone. */
  commitPaths?(paths: readonly string[], message: string, trailer?: CommitTrailer): Promise<unknown>;
}

/** Runs writes one at a time, each with its commit, in the order they came. */
export type DataWriteQueue = <T>(run: () => Promise<T>) => Promise<T>;

/**
 * A write queue to share between writers of one folder: outside board mode a commit holds the whole folder, so a
 * write that ran during another's commit would be filed under the other's trailer.
 */
export function dataWriteQueue(): DataWriteQueue {
  let writes: Promise<unknown> = Promise.resolve();
  return <T>(run: () => Promise<T>): Promise<T> => {
    const next = writes.then(run, run);
    writes = next.catch(() => undefined);
    return next;
  };
}

export interface PersonDataDeps {
  /** The configured folder's data store; null when the app isn't set up. */
  store(): Promise<DataStore | null>;
  /** The open scope (`_app` when none is open; `main` without scopes): the default for the person's requests. */
  chatScope(): Promise<string>;
  /** The open task's history trailer, if a task is open. */
  trailer(): Promise<HistoryTrailer | undefined>;
  /** The folder's history; null when there is none. */
  history(): Promise<DataHistory | null>;
  /**
   * Board mode (parallel spec §5.3): each write commits only its collection's file, never another task's running work.
   * Absent or false: the whole folder, as before (D0).
   */
  board?(): boolean;
  /** Why writes can't run now (a restore, a folder move, an engine change), or null. */
  blocked(): string | null;
  /** Whether `id` is a scope the person can reach: registered and not archived (`main` without scopes). `_app` is never asked. */
  scopeExists(id: string): Promise<boolean>;
  /**
   * A core collection kept in its own store (the reserved `sidekick` one): its store, or undefined for any other
   * collection. Absent: every request goes to `store()` (D0).
   */
  storeFor?(collection: string): Promise<DataStore | null> | undefined;
  /** The write queue shared with the tools' writes (tools spec §8.3). Absent: a queue of its own (D0). */
  serial?: DataWriteQueue;
}

/**
 * The handler of requests from the harness UI (spec §4.5): each runs as the person, in `options.scope` or the open
 * scope, through the same checks as the agent's. The scope must be registered (or `_app`), so no request reaches or
 * creates the data of a scope that doesn't exist. Each write is recorded in the history as `Data: <collection>`,
 * with the open task's trailer, so it is undone with that task. Writes are refused while turns are blocked.
 *
 * Writes run one at a time, each with its own commit: the trailer and the history are taken before the write, and
 * the next write starts only once the commit is saved, so a commit never holds another write's file.
 */
export function personDataRequests(d: PersonDataDeps): (request: unknown, options: unknown) => Promise<unknown> {
  const serial = d.serial ?? dataWriteQueue();
  const storeOf = async (request: unknown): Promise<DataStore | null> => {
    const collection = typeof request === "object" && request !== null ? (request as { collection?: unknown }).collection : undefined;
    const own = typeof collection === "string" ? d.storeFor?.(collection) : undefined;
    return own !== undefined ? own : d.store();
  };

  return async (request, options) => {
    const asked = typeof options === "object" && options !== null ? (options as { scope?: unknown }).scope : undefined;
    if (asked !== undefined && !isScopeDir(asked)) throw new Error("Unknown scope");
    const scopeOf = async (): Promise<string> => {
      const scope = asked ?? (await d.chatScope());
      if (scope !== APP_SCOPE && !(await d.scopeExists(scope))) throw new Error("Unknown scope");
      return scope;
    };
    if (!isDataWrite(request)) {
      const store = await storeOf(request);
      if (!store) throw new Error("The app is not set up yet");
      return runDataRequest(store, request, { who: "person", scope: await scopeOf() });
    }
    return serial(async () => {
      const blocked = d.blocked();
      if (blocked) throw new DataUnavailable(blocked);
      const store = await storeOf(request);
      if (!store) throw new DataUnavailable("The app is not set up yet");
      const scope = await scopeOf();
      const trailer = await d.trailer();
      const history = await d.history();
      const result = await runDataRequest(store, request, { who: "person", scope });
      const collection = String((request as { collection: unknown }).collection);
      try {
        const board = d.board?.() === true;
        const own = board ? [dataPath(store.scopeFor(collection, scope), collection)] : [];
        await saveAppChange(history, board, own, `${DATA_CHANGE_PREFIX}${collection}`, trailer);
      } catch (err) {
        console.error("Could not record the data change in the history", err);
      }
      return result;
    });
  };
}

export interface ToolDataDeps extends Pick<PersonDataDeps, "store" | "history" | "board" | "blocked" | "scopeExists"> {
  /** The scope of a call made in none (no task, no open scope): `_app` with scopes, `main` without. */
  noScope(): string;
  /** The person's write queue (`PersonDataDeps.serial`): one order for both, so no commit holds the other's write. */
  serial: DataWriteQueue;
}

/** One tool call's data context: its scope (null: none), the tool, and the calling task's trailer when it has one. */
export interface ToolDataCall {
  scope: string | null;
  tool: string;
  trailer?: HistoryTrailer;
}

/**
 * A harness tool's data requests (tools spec §8.3): the person's path (same store, scope check and commit), as
 * `who: "tool"` with the tool's id, so collection rules see it and the agent-only limits don't apply. The tool broker
 * has already held the request to the tool's `uses.data`. Each write is recorded as `Data: <collection>` under the
 * calling task's trailer plus `Tool: <id>` (`Tool:` alone with no task). Writes run in the person's queue (`serial`),
 * and the scope is checked again once a write's turn comes, so a scope archived meanwhile is not written.
 *
 * Its error message goes back to the tool (and its trace): a refusal says why; any other failure is logged and the
 * tool gets a plain message, so no file path reaches it.
 */
/** A tool call's scope that isn't registered (or no longer is): its message is the person path's. */
class UnknownScope extends Error {
  constructor() {
    super("Unknown scope");
  }
}

export function toolDataRequests(d: ToolDataDeps): (request: unknown, call: ToolDataCall) => Promise<unknown> {
  const scopeOf = async (call: ToolDataCall): Promise<string> => {
    const scope = call.scope ?? d.noScope();
    if (scope !== APP_SCOPE && !(await d.scopeExists(scope))) throw new UnknownScope();
    return scope;
  };
  const run = async (request: unknown, call: ToolDataCall): Promise<unknown> => {
    if (!isDataWrite(request)) {
      const scope = await scopeOf(call);
      const ctx = { who: "tool" as const, tool: call.tool, scope };
      const store = await d.store();
      if (!store) throw new DataUnavailable("The app is not set up yet");
      return runDataRequest(store, request, ctx);
    }
    // Settings change only through their controller (harness-settings spec), never from a tool.
    if ((request as { collection?: unknown }).collection === SETTINGS_COLLECTION) throw new DataError("refused", "A tool can't change settings");
    return d.serial(async () => {
      const blocked = d.blocked();
      if (blocked) throw new DataUnavailable(blocked);
      const store = await d.store();
      if (!store) throw new DataUnavailable("The app is not set up yet");
      const scope = await scopeOf(call);
      const ctx = { who: "tool" as const, tool: call.tool, scope };
      const history = await d.history();
      const result = await runDataRequest(store, request, ctx);
      const collection = String((request as { collection: unknown }).collection);
      const trailer: CommitTrailer = call.trailer ? { ...call.trailer, tool: call.tool } : { task: null, tool: call.tool };
      try {
        const board = d.board?.() === true;
        const own = board ? [dataPath(store.scopeFor(collection, scope), collection)] : [];
        await saveAppChange(history, board, own, `${DATA_CHANGE_PREFIX}${collection}`, trailer);
      } catch (err) {
        console.error("Could not record the tool's data change in the history", err);
      }
      return result;
    });
  };
  return async (request, call) => {
    if (call.scope !== null && !isScopeDir(call.scope)) throw new UnknownScope();
    try {
      return await run(request, call);
    } catch (err) {
      if (err instanceof DataError || err instanceof DataUnavailable || err instanceof UnknownScope) throw err;
      console.error("A tool's data request failed", err);
      throw new Error("Something went wrong with the data");
    }
  };
}

/**
 * The harness UI's requests (`hh:data`): `run` (the person's handler), except that the UI only reads the reserved
 * `settings` collection. It changes settings through `client.settings`, whose controller keeps their rules (only the
 * changed values stored, an empty record deleted) and writes through `run` itself. Without harness settings nothing
 * changes (D0): `settings` is then an unknown collection, refused by the store as before. The core's `sidekick`
 * collection is always unknown to the UI.
 */
export function harnessUiDataRequests(run: (request: unknown, options: unknown) => Promise<unknown>, hasSettings: () => boolean): (request: unknown, options: unknown) => Promise<unknown> {
  return async (request, options) => {
    // The core's Sidekick collection is never the harness UI's (sidekick spec §6.4): it reads as unknown, as before.
    if (typeof request === "object" && request !== null && (request as { collection?: unknown }).collection === SIDEKICK_COLLECTION) {
      throw new DataError("unknown-collection", `There is no collection "${SIDEKICK_COLLECTION}"`);
    }
    if (hasSettings() && isDataWrite(request) && (request as { collection: unknown }).collection === SETTINGS_COLLECTION) {
      throw new DataError("refused", "Settings change through client.settings");
    }
    return run(request, options);
  };
}

/**
 * An answer's records (input-blocks spec §6 `saveTo`): written as the person, in the task's `scope`, all or none.
 * The write needs no commit of its own: the follow-up's "Before message" commit records it under the task's trailer.
 *
 * Its error message is shown to the person: a refusal (DataError) says why; any other failure is logged and the
 * person gets a plain message, so no file path reaches the window.
 */
export async function saveAnswerRecords(store: () => Promise<DataStore | null>, collection: string, records: Record<string, unknown>[], scope: string): Promise<void> {
  try {
    const s = await store();
    if (!s) throw new DataUnavailable("The app is not set up yet");
    await s.putMany(collection, records, { who: "person", scope });
  } catch (err) {
    if (err instanceof DataError || err instanceof DataUnavailable) throw err;
    console.error("The answer's records could not be saved", err);
    throw new Error("Something went wrong with the data");
  }
}

export interface AgentDataDeps {
  store(): Promise<DataStore | null>;
  /** The open task and the scope it runs in. */
  runningTask(): Promise<{ id: string; action?: string; scope: string } | null>;
  /**
   * The plugin collections' route (plugins spec §3.2): a request naming `<plugin id>.<collection>` goes here, never
   * to the store. It reads only and refuses what isn't a running plugin's `agent: "read"` collection. Absent: a
   * dotted name is an unknown collection, as before (D0).
   */
  plugin?(request: unknown): Promise<unknown>;
}

/**
 * A request from the agent's `data` tools (spec §4.4): it runs as the agent, in the running task's scope. The
 * agent's writes need no commit of their own: the turn's commit records them, under the task's trailer.
 *
 * Its error message goes back to the agent: a refusal (DataError) says why; any other failure is logged and the
 * agent gets a plain message, so no file path or internal detail reaches it.
 */
export async function agentDataRequest(d: AgentDataDeps, request: unknown): Promise<unknown> {
  try {
    const task = await d.runningTask();
    if (!task) throw new DataUnavailable("No task is running");
    // Harness collection names never hold a dot: a dotted one is a plugin's.
    const name = typeof request === "object" && request !== null ? (request as { collection?: unknown }).collection : undefined;
    if (d.plugin && typeof name === "string" && name.includes(".")) return await d.plugin(request);
    const store = await d.store();
    if (!store) throw new DataUnavailable("The app is not set up yet");
    return await runDataRequest(store, request, { who: "agent", scope: task.scope, ...(task.action ? { action: task.action } : {}) });
  } catch (err) {
    if (err instanceof DataError || err instanceof DataUnavailable) throw err;
    console.error("The agent's data request failed", err);
    throw new Error("Something went wrong with the data");
  }
}
