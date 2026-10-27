import type { DataChangeView } from "./client";

/** The folder of app-wide collections (`APP_SCOPE` in the workspace; the UI imports no workspace code). */
const APP_SCOPE = "_app";

/**
 * Whether `data.subscribe(collection, scope, …)` hears `change`: its collection, in `scope` (null: any scope).
 * App-wide collections ignore the scope, as everywhere else: their writes (scope `_app`) are always heard.
 * Its own module so the preload can use it without bundling the rest of the client.
 */
export function hearsDataChange(change: DataChangeView, collection: string, scope: string | null): boolean {
  return change.collection === collection && (scope === null || change.scope === scope || change.scope === APP_SCOPE);
}
