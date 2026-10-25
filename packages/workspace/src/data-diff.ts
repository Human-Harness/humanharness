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

/** A collection file's records by key (`""` for a `single` record); a missing or broken file has none. */
function recordsOf(text: string | null, key: string | undefined): Map<string, DataRecord> {
  const out = new Map<string, DataRecord>();
  if (text === null) return out;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return out;
  }
  if (key === undefined) {
    if (isObject(raw)) out.set("", raw);
    return out;
  }
  if (!Array.isArray(raw)) return out;
  for (const r of raw) if (isObject(r) && r[key] !== undefined) out.set(String(r[key]), r);
  return out;
}

/** Records added, changed and removed between two versions of a collection file. */
export function diffCollection(before: string | null, after: string | null, key: string | undefined): RecordDiff {
  const a = recordsOf(before, key);
  const b = recordsOf(after, key);
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
  const task = (await history.tasks()).find((t) => t.taskId === taskId);
  if (!task) return [];
  const out: CollectionDiff[] = [];
  for (const change of task.changes) {
    const at = parseDataPath(change.path);
    if (!at || !Object.hasOwn(collections, at.collection)) continue;
    const c = collections[at.collection];
    const diff = diffCollection(await history.readFileAt(task.start, change.path), await history.readFileAt(task.end, change.path), c.single ? undefined : c.key);
    if (diff.added.length || diff.changed.length || diff.removed.length) out.push({ collection: at.collection, scope: at.scope, ...diff });
  }
  return out;
}
