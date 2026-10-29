import path from "node:path";
import { BACKEND_CALLS_IN_FLIGHT, BACKEND_LINE_MAX, type BackendInit, type BackendScope, hasBackend } from "@humanharness/harness-sdk";
import { type LinkedFolderEntry, type ScopeEntry, isProfileId } from "@humanharness/workspace";
import type { BackendLog } from "./backend-log";
import { isBackendName } from "./backend-protocol";
import { BackendSupervisor, type BackendState, type SupervisedProcess } from "./backend-supervisor";

/** Decision 8: the backend's own error message reaches the window, cut to this many characters. */
const MESSAGE_MAX = 500;

export interface BackendWiringDeps {
  /** Spawns one process (BackendProcess.start on the harness's launcher, entry and folder). */
  startProcess: (init: BackendInit, onEvent: (event: string, data: unknown) => void) => Promise<SupervisedProcess>;
  /** Pushes to the app's window (never throws in main, but a throw here is caught too). */
  send: (channel: string, value: unknown) => void;
  log: Pick<BackendLog, "write">;
  /** The main process's log (console.error in the app). */
  mainLog: (message: string, err?: unknown) => void;
}

/**
 * The harness backend's supervisor, wired to the window and the logs; null for a harness without `backend` (D0: no
 * supervisor, no process, no file, nothing pushed). A start that fails is written to backend.log, once per attempt;
 * `failed` writes one line to the main log (Decision 9).
 */
export function backendFor(h: { backend?: string }, d: BackendWiringDeps): BackendSupervisor | null {
  if (!hasBackend(h)) return null;
  return new BackendSupervisor({
    startProcess: async (init, onEvent) => {
      try {
        return await d.startProcess(init, onEvent);
      } catch (err) {
        void d.log.write("app", `Could not start the backend: ${err instanceof Error ? err.message : String(err)}`);
        throw err;
      }
    },
    onEvent: (event, data) => {
      // The process's reader must never see a throw from the window side.
      try {
        d.send("hh:backendEvent", { event, data });
      } catch (err) {
        d.mainLog("Could not send a backend event to the window", err);
      }
    },
    onState: (s) => {
      if (s === "failed") d.mainLog("The harness's backend stopped working after crashing too often; see backend.log");
      try {
        d.send("hh:backendStateChange", s);
      } catch (err) {
        d.mainLog("Could not send the backend's state to the window", err);
      }
    },
  });
}

/** What the channels need of the supervisor. */
export type BackendIpcSupervisor = Pick<BackendSupervisor, "state" | "call" | "restart">;

/**
 * The window's channels to the backend (threat model B2), registered only for a harness with `backend` (D0), through
 * `handle()` (the app's page only). Methods match the name pattern; params must serialise and fit in 1 MB; at most
 * BACKEND_CALLS_IN_FLIGHT calls wait at once.
 */
export function registerBackendIpc(
  handle: (channel: string, fn: (...args: never[]) => unknown) => void,
  d: { supervisor: BackendIpcSupervisor },
): void {
  let inFlight = 0;
  handle("hh:backendCall", async (method: unknown, params: unknown) => {
    if (!isBackendName(method)) throw new Error("Invalid backend method");
    let text: string | undefined;
    try {
      text = JSON.stringify(params ?? null);
    } catch {
      text = undefined;
    }
    if (text === undefined) throw new Error("The call's params can't be sent to the backend");
    if (Buffer.byteLength(text) > BACKEND_LINE_MAX) throw new Error("Too large");
    if (inFlight >= BACKEND_CALLS_IN_FLIGHT) throw new Error("Too many calls to the backend");
    inFlight++;
    try {
      return await d.supervisor.call(method, params);
    } catch (err) {
      throw new Error((err instanceof Error ? err.message : String(err)).slice(0, MESSAGE_MAX));
    } finally {
      inFlight--;
    }
  });
  handle("hh:backendState", (): BackendState => d.supervisor.state());
  // The card's "Restart": only a failed backend; a running or starting one is left alone.
  handle("hh:backendRestart", async () => {
    if (d.supervisor.state() === "failed") await d.supervisor.restart();
  });
}

/**
 * Each active scope's links as a turn would use them now: `usable(scope)` is the scope access's `entries` (signed,
 * live, declared, today's mode, still the folder linked, the picker's refusals passed). A scope without links reads
 * nothing.
 */
export async function usableLinks(
  scopes: ScopeEntry[],
  usable: (scope: string) => Promise<ScopeEntry[]>,
): Promise<(s: ScopeEntry) => LinkedFolderEntry[]> {
  const by = new Map<string, LinkedFolderEntry[]>();
  for (const s of scopes) {
    if (s.archived || !s.linked?.length) continue;
    by.set(s.id, (await usable(s.id)).find((e) => e.id === s.id)?.linked ?? []);
  }
  return (s) => by.get(s.id) ?? [];
}

/**
 * The backend's `init` for a base (Decisions 3, 4; threat model B7): exactly BackendInit's keys, no credential. Scopes
 * are the active ones; their links only those `links` vouches for (usableLinks: a turn's checks), none without it.
 */
export function backendInit(o: {
  base: string;
  scopes: ScopeEntry[];
  links?: (s: ScopeEntry) => LinkedFolderEntry[];
  language: string;
  coreVersion: string;
  userData: string;
  /** With profiles, the active profile's id. */
  profile?: string;
  mock: boolean;
}): BackendInit {
  if (o.profile !== undefined && !isProfileId(o.profile)) throw new Error("Invalid profile id");
  const scopes: BackendScope[] = o.scopes
    .filter((s) => !s.archived)
    .map((s) => ({ id: s.id, title: s.title, linked: (o.links?.(s) ?? []).map((l) => ({ key: l.key, path: l.path, mode: l.mode })) }));
  const dataDir = o.profile !== undefined ? path.join(o.userData, "backend-data", o.profile) : path.join(o.userData, "backend-data");
  return { folder: o.base, scopes, language: o.language, coreVersion: o.coreVersion, dataDir, mock: o.mock };
}
