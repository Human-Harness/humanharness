import path from "node:path";
import { COLLECTION_NAME } from "@humanharness/harness-sdk";

// Every path under `<base>/.harness/` comes from here. `base` is the configured folder today; the profiles
// plan makes it the active profile's folder (scopes-and-data spec §7.1) by changing only what callers pass.

/** Where notes live, relative to the base (forward slashes, as the history and the index show it). */
export const NOTES_PREFIX = ".harness/notes/";

/** The implicit scope of a harness without scopes (spec D2), and the scope a migration moves old work into. */
export const MAIN_SCOPE = "main";
/** Where app-wide work goes (tasks outside any scope, app-wide collections). Never a scope id. */
export const APP_SCOPE = "_app";
/** A scope id: a slug of its title. */
export const SCOPE_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const isScopeId = (v: unknown): v is string => typeof v === "string" && SCOPE_ID.test(v);
/** A scope id or `_app`: the name of a scope's folder or file. */
export const isScopeDir = (v: unknown): v is string => v === APP_SCOPE || isScopeId(v);

/** `scope` when it is a scope id or `_app`; throws otherwise (it names a folder). */
export function scopeDir(scope: string): string {
  if (!isScopeDir(scope)) throw new Error(`Invalid scope: "${scope}"`);
  return scope;
}

/** The notes folder of `scope`, relative to the base: flat without scopes (D2), `notes/<scope>/` with them. */
export function notesPrefix(scoped: boolean, scope: string = MAIN_SCOPE): string {
  return scoped ? `${NOTES_PREFIX}${scopeDir(scope)}/` : NOTES_PREFIX;
}

export const harnessDir = (base: string): string => path.join(base, ".harness");
export const tasksFile = (base: string): string => path.join(base, ".harness", "tasks.json");
export const usageFile = (base: string): string => path.join(base, ".harness", "usage.jsonl");
/** The state of the harness's setup steps (setup-steps spec §4). */
export const setupFile = (base: string): string => path.join(base, ".harness", "setup.json");
/**
 * The profile registry (profiles spec §4). It sits under the **app's** folder (the root), never under a base: in a
 * harness with profiles every base is a profile's folder inside the root.
 */
export const profilesFile = (root: string): string => path.join(root, ".harness", "profiles.json");
export const scopesFile =(base: string): string => path.join(base, ".harness", "scopes.json");
export const chatsDir = (base: string): string => path.join(base, ".harness", "chats");
/** One chat per scope; `main.jsonl` for `main`, which is also the chat of a harness without scopes. */
export const chatFile = (base: string, scope: string = MAIN_SCOPE): string => path.join(chatsDir(base), `${scopeDir(scope)}.jsonl`);

/** Where harness data lives, relative to the base: `<scope>/<collection>.json`. Tracked by the history (spec D4). */
export const DATA_PREFIX = ".harness/data/";
/** When each record last changed (for "most recently changed", spec §4.4). Never tracked. */
export const DATA_META_PREFIX = ".harness/data-meta/";

function collectionName(name: string): string {
  if (!COLLECTION_NAME.test(name)) throw new Error(`Invalid collection: "${name}"`);
  return name;
}

/** The folder of one scope's collections. */
export const dataDir = (base: string, scope: string): string => path.join(base, ...`${DATA_PREFIX}${scopeDir(scope)}`.split("/"));

/** A collection file's path relative to the base (forward slashes, as the history shows it). */
export const dataPath = (scope: string, collection: string): string => `${DATA_PREFIX}${scopeDir(scope)}/${collectionName(collection)}.json`;
export const dataFile = (base: string, scope: string, collection: string): string => path.join(base, ...dataPath(scope, collection).split("/"));
export const dataMetaFile = (base: string, scope: string, collection: string): string =>
  path.join(base, ...`${DATA_META_PREFIX}${scopeDir(scope)}/${collectionName(collection)}.json`.split("/"));

/** The scope and collection of a `.harness/data/<scope>/<collection>.json` path; null for anything else. */
export function parseDataPath(rel: string): { scope: string; collection: string } | null {
  const m = /^\.harness\/data\/([^/]+)\/([^/]+)\.json$/.exec(rel);
  return m && isScopeDir(m[1]) && COLLECTION_NAME.test(m[2]) ? { scope: m[1], collection: m[2] } : null;
}
