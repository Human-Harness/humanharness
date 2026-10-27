import type { Collection, DataRecord } from "@humanharness/harness-sdk";
import type { History } from "./history";
import { parseDataPath } from "./layout";

export interface RecordDiff {
  added: DataRecord[];
  changed: { before: DataRecord; after: DataRecord }[];
  removed: DataRecord[];
}

/** What a task changed in one collection of one scope (spec §4.5 `dataDiff`). */
export interface CollectionDiff extends RecordDiff {
  collection: string;
  scope: string;
}

const isObject = (v: unknown): v is DataRecord => typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON with object keys sorted, so two records compare equal whatever their key order. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (isObject(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}

/** A collection file's records by key (`""` for a `single` record); a missing file has none, a file that doesn't parse or has the wrong shape is null. */
function recordsOf(text: string | null, key: string | undefined): Map<string, DataRecord> | null {
  const out = new Map<string, DataRecord>();
  if (text === null) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (key === undefined) {
    if (!isObject(raw)) return null;
    out.set("", raw);
    return out;
  }
  if (!Array.isArray(raw)) return null;
  for (const r of raw) if (isObject(r) && r[key] !== undefined) out.set(String(r[key]), r);
  return out;
}

/** Records added, changed and removed between two versions of a collection file. */
export function diffCollection(before: string | null, after: string | null, key: string | undefined): RecordDiff {
  const a = recordsOf(before, key) ?? new Map<string, DataRecord>();
  const b = recordsOf(after, key) ?? new Map<string, DataRecord>();
  const diff: RecordDiff = { added: [], changed: [], removed: [] };
  for (const [k, r] of b) {
    const prev = a.get(k);
    if (!prev) diff.added.push(r);
    else if (stable(prev) !== stable(r)) diff.changed.push({ before: prev, after: r });
  }
  for (const [k, r] of a) if (!b.has(k)) diff.removed.push(r);
  return diff;
}

/** What task `taskId` changed in the harness's data, from its history diff (start → end). */
export async function dataDiffOf(history: History, taskId: string, collections: Record<string, Collection>): Promise<CollectionDiff[]> {
  // history.tasks() reads a bounded window of recent commits (its default depth), so a very old task has no diff.
  const task = (await history.tasks()).find((t) => t.taskId === taskId);
  if (!task) return [];
  const out: CollectionDiff[] = [];
  for (const change of task.changes) {
    const at = parseDataPath(change.path);
    if (!at || !Object.hasOwn(collections, at.collection)) continue;
    const c = collections[at.collection];
    const key = c.single ? undefined : c.key;
    const [before, after] = [await history.readFileAt(task.start, change.path), await history.readFileAt(task.end, change.path)];
    // A side that doesn't parse would read as "everything added/removed": skip the collection instead.
    if (recordsOf(before, key) === null || recordsOf(after, key) === null) {
      console.error(`Skipping the data diff of ${change.path}: a version of it is not valid`);
      continue;
    }
    const diff = diffCollection(before, after, key);
    if (diff.added.length || diff.changed.length || diff.removed.length) out.push({ collection: at.collection, scope: at.scope, ...diff });
  }
  return out;
}
