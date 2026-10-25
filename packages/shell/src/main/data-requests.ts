import { DATA_CHANGE_PREFIX, type DataStore, type HistoryTrailer, isDataWrite, isScopeDir, runDataRequest } from "@humanharness/workspace";

export interface PersonDataDeps {
  /** The configured folder's data store; null when the app isn't set up. */
  store(): Promise<DataStore | null>;
  /** The open scope (`_app` when none is open; `main` without scopes): the default for the person's requests. */
  chatScope(): Promise<string>;
  /** The open task's history trailer, if a task is open. */
  trailer(): Promise<HistoryTrailer | undefined>;
  saveHistory(message: string, trailer?: HistoryTrailer): Promise<void>;
  /** Why writes can't run now (a restore, a folder move, an engine change), or null. */
  blocked(): string | null;
}

/**
 * A request from the harness UI (spec §4.5): it runs as the person, in `options.scope` or the open scope, through
 * the same checks as the agent's. Each write is recorded in the history as `Data: <collection>`, with the open
 * task's trailer, so it is undone with that task. Writes are refused while turns are blocked.
 */
export async function personDataRequest(d: PersonDataDeps, request: unknown, options: unknown): Promise<unknown> {
  const write = isDataWrite(request);
  if (write) {
    const blocked = d.blocked();
    if (blocked) throw new Error(blocked);
  }
  const asked = typeof options === "object" && options !== null ? (options as { scope?: unknown }).scope : undefined;
  if (asked !== undefined && !isScopeDir(asked)) throw new Error("Unknown scope");
  const store = await d.store();
  if (!store) throw new Error("The app is not set up yet");
  const scope = asked ?? (await d.chatScope());
  const result = await runDataRequest(store, request, { who: "person", scope });
  if (write) {
    const collection = String((request as { collection: unknown }).collection);
    try {
      await d.saveHistory(`${DATA_CHANGE_PREFIX}${collection}`, await d.trailer());
    } catch (err) {
      console.error("Could not record the data change in the history", err);
    }
  }
  return result;
}
