import { promises as fs } from "node:fs";
import path from "node:path";
import { MaterialSearch, MaterialStore, flagFragment, isFragmentId, readForTask, usableFragment } from "@humanharness/material/light";
import { APP_SCOPE, isScopeId, materialReadsFile } from "@humanharness/workspace";

/** A refusal whose message goes back to the agent. */
export class MaterialRefusal extends Error {}

export interface PersonMaterialDeps {
  /** The base the runtime was built for; null when the app isn't set up. */
  base(): Promise<string | null>;
  runningTask(): Promise<{ id: string; scope: string } | null>;
  /**
   * The app's one store of a base and scope (`MaterialService.storeAt`), so the agent's writes share its queue.
   * Default: a new store (tests).
   */
  store?(base: string, scope: string): MaterialStore;
  /** A fragment was flagged: the queue of AI stages looks for work. */
  flagged?(): void;
  now?: () => Date;
}

const short = (id: unknown) => String(id).slice(0, 80);

/** At most this many `material_conflict` lines per task: a looping agent can't flood `conflicts.md` (and the history). */
export const CONFLICTS_PER_TASK = 20;
/** Conflict lines written per base and task; only the latest tasks are remembered. */
const conflictCounts = new Map<string, number>();
const COUNTS_KEPT = 200;

function countConflict(key: string): boolean {
  const n = conflictCounts.get(key) ?? 0;
  if (n >= CONFLICTS_PER_TASK) return false;
  conflictCounts.delete(key);
  conflictCounts.set(key, n + 1);
  if (conflictCounts.size > COUNTS_KEPT) conflictCounts.delete(conflictCounts.keys().next().value as string);
  return true;
}

/**
 * The `material` server's person-mode tools (§9 Fetch), in the running task's scope. Each read is logged as
 * `{ at, task, scope, id }` in `.harness/material-reads.jsonl`. Refusals' messages are safe for the agent; anything
 * else is logged and answered with a plain line.
 */
export async function personMaterialRequest(d: PersonMaterialDeps, request: unknown): Promise<unknown> {
  try {
    const task = await d.runningTask();
    if (!task) throw new MaterialRefusal("No task is running");
    if (task.scope === APP_SCOPE || !isScopeId(task.scope)) throw new MaterialRefusal("This task has no material");
    const base = await d.base();
    if (!base) throw new MaterialRefusal("The app is not set up yet");
    const store = d.store ? d.store(base, task.scope) : new MaterialStore(base, task.scope);
    const r = typeof request === "object" && request !== null ? (request as Record<string, unknown>) : {};
    if (r.op === "read") {
      const text = isFragmentId(r.id) ? await readForTask(store, r.id) : null;
      if (text === null) throw new MaterialRefusal(`No fragment ${short(r.id)}`);
      const file = materialReadsFile(base);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, `${JSON.stringify({ at: (d.now?.() ?? new Date()).toISOString(), task: task.id, scope: task.scope, id: r.id })}\n`);
      return text;
    }
    if (r.op === "search" && typeof r.query === "string") return MaterialSearch.of(await store.fragments()).search(r.query);
    if (r.op === "flag" && typeof r.reason === "string") {
      if (!isFragmentId(r.id) || !(await flagFragment(store, r.id, r.reason))) throw new MaterialRefusal(`No fragment ${short(r.id)}`);
      d.flagged?.();
      return "Thanks: it will be checked again.";
    }
    if (r.op === "conflict" && typeof r.claim === "string" && typeof r.resolution === "string") {
      // Only a fragment of a usable source in this scope (the same rule as a read); the line goes to `conflicts.md`.
      if (!isFragmentId(r.fragment) || !(await usableFragment(store, r.fragment))) throw new MaterialRefusal(`No fragment ${short(r.fragment)}`);
      if (!countConflict(`${base}\0${task.id}`)) throw new MaterialRefusal(`This task already noted ${CONFLICTS_PER_TASK} conflicts`);
      await store.appendConflict({ fragment: r.fragment, claim: r.claim.slice(0, 300), resolution: r.resolution.slice(0, 300) }, d.now?.());
      return "Noted.";
    }
    throw new MaterialRefusal("Unknown request");
  } catch (err) {
    if (err instanceof MaterialRefusal) throw err;
    console.error("The agent's material request failed", err);
    throw new Error("Something went wrong with the material");
  }
}
