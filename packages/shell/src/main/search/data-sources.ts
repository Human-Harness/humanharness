// Global search's harness collections (search spec D4): which ones, in which folders, and their records as rows.
import type { Collection } from "@humanharness/harness-sdk";
import { type DataRow, type DataSource, type RecordSearch, recordRows } from "@humanharness/search";
import { APP_SCOPE, type DataStore, MAIN_SCOPE, dataFile, dataMetaFile } from "@humanharness/workspace";
import { sourceStamp } from "./stamp";

export interface HarnessSourcesDeps {
  base: string;
  collections: Record<string, Collection>;
  scoped: boolean;
  /** The scopes that aren't archived (harnesses with scopes). */
  scopes: () => Promise<string[]>;
}

/** What decides a searchable collection's rows besides its records. */
const declaration = (c: Collection & { search: NonNullable<Collection["search"]> }): RecordSearch => ({
  ...(c.key ? { key: c.key } : {}),
  single: c.single,
  search: c.search,
});

/**
 * Every collection that opted in with `search`, once per folder it lives in: an app-wide one in `_app`, a scoped one in
 * each scope that isn't archived (`main` without scopes). The stamp follows the records file, its meta file and the
 * declaration (`sourceStamp`), so a meta-only write or a changed `search` reads the records again.
 */
export async function harnessSources(d: HarnessSourcesDeps): Promise<DataSource[]> {
  const cols = Object.entries(d.collections).filter((e): e is [string, Collection & { search: NonNullable<Collection["search"]> }] => e[1].search !== undefined);
  if (cols.length === 0) return [];
  const folders = cols.some(([, c]) => c.scoped) ? (d.scoped ? await d.scopes() : [MAIN_SCOPE]) : [];
  const out: DataSource[] = [];
  for (const [name, c] of cols) {
    for (const folder of c.scoped ? folders : [APP_SCOPE]) {
      const stamp = await sourceStamp([dataFile(d.base, folder, name), dataMetaFile(d.base, folder, name)], declaration(c));
      out.push({ id: `harness:${folder}/${name}`, owner: "harness", collection: name, folder, stamp });
    }
  }
  return out;
}

/** A harness source's records as rows (`recordRows`), through the base's one store (so its write queue orders the reads). */
export async function harnessRows(store: Pick<DataStore, "readAll" | "changedAt">, collections: Record<string, Collection>, s: DataSource): Promise<DataRow[]> {
  const c = Object.hasOwn(collections, s.collection) ? collections[s.collection] : undefined;
  if (!c?.search) return [];
  const search = c.search;
  const [{ records }, changed] = await Promise.all([store.readAll(s.collection, s.folder), store.changedAt(s.collection, s.folder)]);
  return recordRows(records, declaration({ ...c, search }), changed);
}
