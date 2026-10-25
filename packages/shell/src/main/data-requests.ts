import { DATA_CHANGE_PREFIX, DataError, type DataStore, type HistoryTrailer, isDataWrite, isScopeDir, runDataRequest } from "@humanharness/workspace";

/** Where a person's write is recorded: the folder's history. */
export interface DataHistory {
  save(message: string, trailer?: HistoryTrailer): Promise<unknown>;
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
  /** Why writes can't run now (a restore, a folder move, an engine change), or null. */
  blocked(): string | null;
}

/**
 * The handler of requests from the harness UI (spec §4.5): each runs as the person, in `options.scope` or the open
 * scope, through the same checks as the agent's. Each write is recorded in the history as `Data: <collection>`,
 * with the open task's trailer, so it is undone with that task. Writes are refused while turns are blocked.
 *
 * Writes run one at a time, each with its own commit: the trailer and the history are taken before the write, and
 * the next write starts only once the commit is saved, so a commit never holds another write's file.
 */
export function personDataRequests(d: PersonDataDeps): (request: unknown, options: unknown) => Promise<unknown> {
  let writes: Promise<unknown> = Promise.resolve();
  const serial = <T>(run: () => Promise<T>): Promise<T> => {
    const next = writes.then(run, run);
    writes = next.catch(() => undefined);
    return next;
  };

  return async (request, options) => {
    const asked = typeof options === "object" && options !== null ? (options as { scope?: unknown }).scope : undefined;
    if (asked !== undefined && !isScopeDir(asked)) throw new Error("Unknown scope");
    if (!isDataWrite(request)) {
      const store = await d.store();
      if (!store) throw new Error("The app is not set up yet");
      return runDataRequest(store, request, { who: "person", scope: asked ?? (await d.chatScope()) });
    }
    return serial(async () => {
      const blocked = d.blocked();
      if (blocked) throw new Error(blocked);
      const store = await d.store();
      if (!store) throw new Error("The app is not set up yet");
      const scope = asked ?? (await d.chatScope());
      const trailer = await d.trailer();
      const history = await d.history();
      const result = await runDataRequest(store, request, { who: "person", scope });
      const collection = String((request as { collection: unknown }).collection);
      try {
        await history?.save(`${DATA_CHANGE_PREFIX}${collection}`, trailer);
      } catch (err) {
        console.error("Could not record the data change in the history", err);
      }
      return result;
    });
  };
}

/** The agent's request can't run now; its message is safe to show the agent. */
class Unavailable extends Error {}

export interface AgentDataDeps {
  store(): Promise<DataStore | null>;
  /** The open task and the scope it runs in. */
  runningTask(): Promise<{ id: string; action?: string; scope: string } | null>;
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
    if (!task) throw new Unavailable("No task is running");
    const store = await d.store();
    if (!store) throw new Unavailable("The app is not set up yet");
    return await runDataRequest(store, request, { who: "agent", scope: task.scope, ...(task.action ? { action: task.action } : {}) });
  } catch (err) {
    if (err instanceof DataError || err instanceof Unavailable) throw err;
    console.error("The agent's data request failed", err);
    throw new Error("Something went wrong with the data");
  }
}
