import { isFragmentId } from "./fragment";
import type { MaterialStore } from "./store";

// These run in the app process, the one owner of a scope's registry; the `material` server only forwards the calls.

/** `material_read` (§9 Fetch): the fragment with its citation and where it comes from; counts the source's use. */
export async function readForTask(store: MaterialStore, id: string): Promise<string | null> {
  if (!isFragmentId(id)) return null;
  const f = await store.readFragment(id);
  if (!f) return null;
  const owner = (await store.sources()).find((s) => Array.isArray(s.fragments) && s.fragments.includes(id));
  if (!owner) return null;
  await store.patch(owner.id, (s) => ({ ...s, used: s.used + 1 }));
  return `[[frag:${id}]] ${f.meta.source}, ${f.meta.location}${f.meta.path ? ` (${f.meta.path})` : ""}\n\n${f.md}`;
}

/**
 * `material_flag` (§6.2 "Flags during use"): the fragment goes `pending` (out of the index) and its source back to
 * the review stage, which the queue picks up after the person's turn.
 */
export async function flagFragment(store: MaterialStore, id: string, reason: string): Promise<boolean> {
  if (!isFragmentId(id)) return false;
  const owner = (await store.sources()).find((s) => Array.isArray(s.fragments) && s.fragments.includes(id));
  if (!owner || !(await store.patchFragment(id, (m) => ({ ...m, validated: "pending" })))) return false;
  const line = `Flagged in use: ${id}: ${reason.replace(/\s+/g, " ").trim().slice(0, 200)}`;
  await store.patch(owner.id, (s) => ({ ...s, status: "validating", stage: "review", issues: [...s.issues, line] }));
  await store.writeIndex();
  return true;
}
