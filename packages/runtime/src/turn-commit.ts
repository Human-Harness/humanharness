import {
  type Attribution,
  BEFORE_MESSAGE,
  type History,
  type HistoryTrailer,
  SHARED_PREFIX,
  STOPPED_PREFIX,
  TURN_PREFIX,
  UNDO_PREFIX,
  attribute,
  conflictsOf,
} from "@humanharness/workspace";
import type { Event } from "./events";
import { type TurnLedger, type TurnWindow, samePath } from "./turn-ledger";

type Done = Extract<Event, { type: "done" }>;

/** What a turn that overlapped others committed (parallel spec §5.2–5.3); null for a turn that ran alone (D7). */
export type TurnAttribution = Pick<Attribution, "owned" | "shared" | "with"> & { conflicts: { path: string; tasks: string[] }[] };

/** How far back `endTurn` looks for other tasks' commits since a turn's start. */
const CONFLICT_DEPTH = 200;

/**
 * Opens `key`'s window and its start point. Alone: today's `Before message` snapshot. Beside another turn: no snapshot
 * (Decision 2), the queue head and the dirty paths instead. The window opens before any await, so two turns that start
 * together never both think they are alone.
 *
 * The head is read first: `last()` isn't queued, `dirtyState()` is, so a commit still queued (another turn's end) lands
 * after `before` and before the dirty snapshot. Its paths then come back from `commitsSince(before)` as a possible
 * conflict instead of slipping between the two (the reverse order would miss them).
 */
export async function beginTurn(history: History, ledger: TurnLedger, key: string, trailer?: HistoryTrailer): Promise<TurnWindow> {
  const w = ledger.open(key, trailer?.task);
  try {
    if (w.alone) w.before = (await history.save(BEFORE_MESSAGE, trailer)) ?? (await history.last());
    else {
      w.before = await history.last();
      w.startDirty = await history.dirtyState();
    }
  } catch (err) {
    ledger.close(key);
    throw err;
  }
  return w;
}

/**
 * Commits the turn's end. A window that never overlapped: exactly today's code (Turn / Undo by whole restore / Stopped).
 * Overlapped: its own paths in one commit, the shared ones in a second (Decision 5); a crash restores only its own paths
 * from the queue head (Decision 6), never another task's.
 *
 * An overlapped window stays open until its commits are done: a turn that starts meanwhile is then not alone and takes
 * no `Before message` snapshot, which would put this turn's still uncommitted paths under the new turn's trailer.
 */
export async function endTurn(
  history: History,
  ledger: TurnLedger,
  w: TurnWindow,
  done: Done,
  message: string,
  trailer?: HistoryTrailer,
): Promise<TurnAttribution | null> {
  const crashed = !done.ok && done.error.code === "agent-crashed";
  if (!w.overlapped) {
    // Closed before the first queued call, so a turn that starts now snapshots after this turn's commit.
    ledger.close(w.key);
    if (done.ok) await history.save(`${TURN_PREFIX}${message.slice(0, 60)}`, trailer);
    else if (crashed && w.before) await history.restore(w.before, `${UNDO_PREFIX}the turn did not finish`, trailer);
    else await history.save(`${STOPPED_PREFIX}${message.slice(0, 60)}`, trailer);
    return null;
  }
  // The ending turn's own task never shares with itself (no `Shared:` trailer naming it).
  const others = ledger.running().filter((o) => o !== w && (w.task === undefined || o.task !== w.task));
  try {
    // changedSince, the commits and commitsSince are separate queue entries: another turn's commit may land between
    // them. A path it committed is clean against HEAD and drops out of `changed` (or commits as nothing changed).
    const names = byPathForm(await history.changedSince(w.startDirty));
    const a = attribute({
      changed: [...names.keys()],
      overlapped: true,
      ownEdits: w.edits,
      others: others.map((o) => ({ task: o.task ?? o.key, edits: o.edits })),
    });
    const owned = a.owned.flatMap((p) => names.get(p) ?? []);
    const shared = a.shared.flatMap((p) => names.get(p) ?? []);
    let first: string | null;
    if (crashed) {
      // "HEAD" resolves inside restorePaths' own queue entry: the head as it is then, not as it was a step ago, so a
      // commit another turn made in between is never undone. With one turn's own paths that is usually no commit.
      first = (await history.restorePaths(owned, "HEAD", `${UNDO_PREFIX}the turn did not finish`, trailer)).sha;
      if (shared.length > 0) console.error("Crash restore left shared paths", shared);
    } else {
      const subject = (done.ok ? TURN_PREFIX : STOPPED_PREFIX) + message.slice(0, 60);
      first = await history.commitPaths(owned, subject, trailer);
      if (shared.length > 0) {
        const s = await history.commitPaths(shared, `${SHARED_PREFIX}${message.slice(0, 60)}`, { ...(trailer ?? { task: w.key }), shared: a.with });
        first ??= s;
      }
    }
    const conflicts = await conflictsSince(history, w.before, first, [...owned, ...shared], trailer?.task);
    return { owned, shared, with: a.with, conflicts };
  } finally {
    ledger.close(w.key);
  }
}

/** `changed` keyed by its NFC form (edit paths are NFC too), each key with the names git gave it. */
function byPathForm(changed: readonly string[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const p of changed) {
    const k = samePath(p);
    out.set(k, [...(out.get(k) ?? []), p]);
  }
  return out;
}

/**
 * Other tasks' commits since `before` that changed `paths` (spec §5.3). Read after this turn's own commits so every
 * commit that landed between its queue entries is seen; the commits after `first` (this turn's own first commit) came
 * after its end and don't count. When `before` lies beyond the depth, `commitsSince` returns the whole window and
 * which commits came after the start is unknown: no conflict is reported rather than false ones.
 */
async function conflictsSince(
  history: History,
  before: string | null,
  first: string | null,
  paths: readonly string[],
  ownTask: string | undefined,
): Promise<TurnAttribution["conflicts"]> {
  if (before === null || paths.length === 0) return [];
  const commits = await history.commitsSince(before, CONFLICT_DEPTH);
  if (commits.length >= CONFLICT_DEPTH) return [];
  const mine = first === null ? -1 : commits.findIndex((c) => c.sha === first);
  return conflictsOf(paths, mine >= 0 ? commits.slice(mine + 1) : commits, ownTask);
}
