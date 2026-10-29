import { promises as fs } from "node:fs";
import { type ScopeEntry, tasksFile } from "@humanharness/workspace";
import { pruneSnapshots } from "./snapshot";

// Snapshot cleanup (hatches Decision 13). A snapshot is trashed only when no scope's approval names its hash, no live
// task (the current one or a board lane, in any profile's base) is pinned to it, and its folder is over 30 days old.
// Live tasks are kept whatever their age: a running task must never lose the snapshot it was pinned to. Anything
// unreadable stops the prune: a pin it might hold would be lost.

const HASH = /^[0-9a-f]{64}$/;

/** One base the app knows: its scope registry and folder (its tasks.json is read raw, never repaired). */
export interface PruneBase {
  base: string;
  scopes: { list(): Promise<ScopeEntry[]> };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** The hashes in use: every scope's approval (archived or not, signed or not) and every live task's pin. */
export function snapshotsInUse(bases: { scopes: ScopeEntry[]; tasks: unknown }[]): Set<string> {
  const keep = new Set<string>();
  const add = (h: unknown) => {
    if (typeof h === "string" && HASH.test(h)) keep.add(h);
  };
  for (const { scopes, tasks } of bases) {
    for (const s of scopes) add(s.engineApproval?.hash);
    if (!isObject(tasks)) continue;
    const live = [tasks.current, ...(Array.isArray(tasks.lanes) ? tasks.lanes : [])];
    for (const t of live) if (isObject(t)) add(t.engineHash);
  }
  return keep;
}

/** A base's tasks.json as JSON: undefined when there is none; throws when it can't be read or parsed. */
async function readTasks(base: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.readFile(tasksFile(base), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  return JSON.parse(text) as unknown;
}

/** Trashes the snapshots `bases` no longer use and older than 30 days (see above); logs and stops on a read failure. */
export async function pruneEngineSnapshots(userData: string, bases: PruneBase[], now: Date, trash: (dir: string) => Promise<void>): Promise<void> {
  let inUse: Set<string>;
  try {
    inUse = snapshotsInUse(await Promise.all(bases.map(async (b) => ({ scopes: await b.scopes.list(), tasks: await readTasks(b.base) }))));
  } catch (err) {
    console.error("Could not read which engine config snapshots are in use; none is pruned", err);
    return;
  }
  await pruneSnapshots(userData, inUse, now, trash);
}
