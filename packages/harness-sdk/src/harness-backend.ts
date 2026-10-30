/**
 * The harness backend's protocol (hatches spec §4.2): JSON-RPC 2.0, one JSON message per line on stdin/stdout.
 * Stdout carries protocol messages only; write logs to stderr (it goes to backend.log).
 *
 * A backend written in TypeScript runs on Electron's Node, which strips types itself: use erasable syntax only
 * (no enum, namespace or parameter properties), and import this file with `import type`.
 *
 * No runtime imports here: a backend loads nothing from this package at run time.
 */

/** One scope as the backend sees it, with its linked folders (part 1). */
export interface BackendScope {
  id: string;
  title: string;
  linked: { key: string; path: string; mode: "read" | "write" }[];
}

/** The `init` notification's params, sent once at launch; `scopesChanged` carries the same shape. */
export interface BackendInit {
  /** The person's folder (with profiles, the active profile's). */
  folder: string;
  scopes: BackendScope[];
  /** The person's language, a BCP 47 tag. */
  language: string;
  coreVersion: string;
  /** A folder of the backend's own in the app's data folder, for caches. */
  dataDir: string;
  /** The app runs in mock mode (no engine): fake what the backend would do, if it wants. */
  mock: boolean;
}

/** A call from the window gets no answer after this long: it is refused as timed out. */
export const BACKEND_CALL_TIMEOUT_MS = 30_000;
/** Events past this many in a rolling second are dropped. */
export const BACKEND_EVENTS_PER_SECOND = 200;
/** Restarts after a crash in any window, then the backend is `failed` until the person's Restart. */
export const BACKEND_RESTARTS = { max: 3, windowMs: 5 * 60_000 } as const;
/** Stop sends SIGTERM, then SIGKILL after this long. */
export const BACKEND_STOP_GRACE_MS = 3_000;
/** backend.log rotates to backend.log.1 past this size. */
export const BACKEND_LOG_MAX_BYTES = 5 * 1024 * 1024;
/** A method or event name: what `client.backend.call` and `on` take. */
export const BACKEND_NAME = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,99}$/;
/** The longest protocol line either way, in bytes; a call's params obey it too. */
export const BACKEND_LINE_MAX = 1024 * 1024;
/** The largest event payload, in bytes. */
export const BACKEND_EVENT_MAX = 64 * 1024;
/** Calls from the window waiting for an answer at once; more are refused. */
export const BACKEND_CALLS_IN_FLIGHT = 64;
