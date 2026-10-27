import { isFragmentId } from "./fragment";
import { type MaterialStore, isUsable } from "./store";
import type { Fragment, SourceEntry } from "./types";

// These run in the app process, the one owner of a scope's registry; the `material` server only forwards the calls.

const ownerOf = (list: SourceEntry[], id: string) => list.find((s) => Array.isArray(s.fragments) && s.fragments.includes(id));

/**
 * `material_read` (§9 Fetch): the fragment with its citation and where it comes from. Null when the id isn't one, the
 * fragment is gone or flagged (`pending`: out of loading until the review sees it again), or its source isn't usable
 * (removed, refused, converting…). The caller logs each read in `material-reads.jsonl`; the registry keeps no count,
 * so reads don't make history commits.
 */
export async function readForTask(store: MaterialStore, id: string): Promise<string | null> {
  const f = await usableFragment(store, id);
  if (!f || f.meta.validated === "pending") return null;
  return `[[frag:${id}]] ${f.meta.source}, ${f.meta.location}${f.meta.path ? ` (${f.meta.path})` : ""}\n\n${f.md}`;
}

/**
 * A fragment of a usable source of the scope, read without counting a use: what `material_conflict` and a citation's
 * label (§9) may name. Null otherwise.
 */
export async function usableFragment(store: MaterialStore, id: string): Promise<Fragment | null> {
  if (!isFragmentId(id)) return null;
  const owner = ownerOf(await store.sources(), id);
  return owner && isUsable(owner) ? store.readFragment(id) : null;
}

/**
 * `material_flag` (§6.2 "Flags during use"): the fragment goes `pending` (out of the index) and its source back to
 * the review stage, which the queue picks up after the person's turn. Only a usable source's fragment: a removed,
 * refused or unfinished source keeps its status. The fragment and the registry change in one queued job, so a
 * concurrent `writeFragments` can't erase the mark.
 */
export async function flagFragment(store: MaterialStore, id: string, reason: string, by = "Flagged in use"): Promise<boolean> {
  if (!isFragmentId(id)) return false;
  const line = `${by}: ${id}: ${reason.replace(/\s+/g, " ").trim().slice(0, 200)}`;
  const done = await store.transact(async (rewrite) => {
    const owner = ownerOf(await store.sources(), id);
    if (!owner || !isUsable(owner)) return false;
    if (!(await store.patchFragment(id, (m) => ({ ...m, validated: "pending" })))) return false;
    await rewrite((list) => list.map((s) => (s.id === owner.id ? { ...s, status: "validating", stage: "review", issues: [...s.issues, line] } : s)));
    return true;
  });
  if (done) await store.writeIndex();
  return done;
}
