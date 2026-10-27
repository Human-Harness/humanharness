import type { MaterialStore } from "./store";
import type { MaterialAsk, SourceEntry } from "./types";

export type Choice = MaterialAsk["choices"][number];

/** The answers a question may offer; anything else from the window is refused. */
export const CHOICES: readonly Choice[] = ["keep", "drop", "program", "use", "remove"];

/**
 * The person's answer to a question (§6.2 `ask`): `keep`, `drop` or `program` for a fragment; `use` or `remove` for a
 * whole source. `use` also answers a source waiting for a full review (§7) without one: it goes on with what the
 * sample found. False when there is no such question or choice. `trash` moves the original to the system Trash.
 * Fragment files and the registry change in one queued job (`transact`), like the review's.
 */
export async function decide(store: MaterialStore, sourceId: string, fragment: string | null, choice: Choice, trash: (file: string) => Promise<void>): Promise<boolean> {
  const done = await store.transact(async (rewrite): Promise<boolean | "remove"> => {
    const s = (await store.sources()).find((e) => e.id === sourceId);
    if (!s) return false;
    const patch = (fn: (e: SourceEntry) => SourceEntry) => rewrite((list) => list.map((e) => (e.id === sourceId ? fn(e) : e)));
    if (fragment === null && choice === "use" && s.status === "pending" && s.notice === "full-review") {
      await patch((e) => {
        const { notice: _n, ...rest } = e;
        return { ...rest, status: "validating", stage: (e.repairs ?? []).length > 0 ? "repair" : "label" };
      });
      return true;
    }
    const ask = (s.asks ?? []).find((a) => (a.fragment ?? null) === fragment && a.choices.includes(choice));
    if (!ask) return false;
    if (choice === "remove") return "remove";
    // `asks` is read from the file: a hand edit could hold anything, so only this source's own fragments are touched.
    const others = (s.asks ?? []).filter((a) => a !== ask);
    const fragments = Array.isArray(s.fragments) ? s.fragments : [];
    if (choice === "use") {
      await patch((e) => {
        if (e.status !== "needs-person") return { ...e, asks: others };
        const { stage: _s, reviewQueue: _q, repairs: _r, ...rest } = e;
        return { ...rest, asks: others, status: "ready" };
      });
    } else if (choice === "drop" && fragment && fragments.includes(fragment)) {
      await store.keepOriginal(fragment);
      await store.removeFragment(fragment);
      await patch((e) => ({
        ...e,
        fragments: e.fragments.filter((id) => id !== fragment),
        ...(e.repairs ? { repairs: e.repairs.filter((r) => r.id !== fragment) } : {}),
        ...(e.reviewQueue ? { reviewQueue: e.reviewQueue.filter((id) => id !== fragment) } : {}),
        asks: others,
        fixes: [...e.fixes, `Dropped ${fragment} (your decision)`],
      }));
    } else {
      // keep / program: the fragment stays as the program made it, looked at by the person.
      if (fragment && fragments.includes(fragment)) await store.patchFragment(fragment, (m) => ({ ...m, validated: "flagged-reviewed" }));
      await patch((e) => ({ ...e, asks: others }));
    }
    return true;
  });
  if (done === "remove") return removeSource(store, sourceId, trash);
  if (!done) return false;
  if (choice === "use" || choice === "drop") await store.setStale("sheet");
  await store.writeIndex();
  return true;
}

/**
 * Removes a source (§11): its original to the system Trash (never deleted for good), its fragments gone, its entry
 * marked `removed` (kept in `sources.json` so the history shows it went). The scope's sheet and links run again.
 */
export async function removeSource(store: MaterialStore, sourceId: string, trash: (file: string) => Promise<void>): Promise<boolean> {
  const s = await store.source(sourceId);
  if (!s || s.status === "removed") return false;
  const file = store.originalPath(s.path);
  if (file) await trash(file).catch((err: unknown) => console.error("Could not move the original to the Trash", err));
  await store.transact(async (rewrite) => {
    const now = (await store.sources()).find((e) => e.id === sourceId);
    for (const id of Array.isArray(now?.fragments) ? now.fragments : []) await store.removeFragment(id);
    await rewrite((list) =>
      list.map((e) => {
        if (e.id !== sourceId) return e;
        const { stage: _s, reviewQueue: _q, repairs: _r, notice: _n, failed: _f, fullReview: _full, ...rest } = e;
        return { ...rest, status: "removed", fragments: [], asks: [] };
      }),
    );
  });
  await store.setStale("sheet");
  await store.writeIndex();
  return true;
}
