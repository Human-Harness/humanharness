import path from "node:path";

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
export const scopesFile = (base: string): string => path.join(base, ".harness", "scopes.json");
export const chatsDir = (base: string): string => path.join(base, ".harness", "chats");
/** One chat per scope; `main.jsonl` for `main`, which is also the chat of a harness without scopes. */
export const chatFile = (base: string, scope: string = MAIN_SCOPE): string => path.join(chatsDir(base), `${scopeDir(scope)}.jsonl`);
