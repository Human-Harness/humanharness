// Global search's harness collections (search spec D4): which ones, in which folders, and their records as rows.
import type { Collection } from "@humanharness/harness-sdk";
import type { PluginsView } from "@humanharness/protocol";
import { type DataRow, type DataSource, type RecordSearch, recordRows } from "@humanharness/search";
import { APP_SCOPE, type DataStore, MAIN_SCOPE, dataFile, dataMetaFile } from "@humanharness/workspace";
import type { SearchDataDeps } from "./service";
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

/**
 * A harness source's records as rows (`recordRows`), through the base's one store. Its reads don't wait in the write
 * queue (only writes are serialized): a write landing during the read changes the stamp, so it is read again.
 */
export async function harnessRows(store: Pick<DataStore, "readAll" | "changedAt">, collections: Record<string, Collection>, s: DataSource): Promise<DataRow[]> {
  const c = Object.hasOwn(collections, s.collection) ? collections[s.collection] : undefined;
  if (!c?.search) return [];
  const search = c.search;
  const [{ records }, changed] = await Promise.all([store.readAll(s.collection, s.folder), store.changedAt(s.collection, s.folder)]);
  return recordRows(records, declaration({ ...c, search }), changed);
}

/** A running plugin's searchable collections and rows, as the plugins controller answers them. */
export interface PluginSearch {
  searchSources(base: string): Promise<DataSource[] | null>;
  searchRows(plugin: string, collection: string, base: string): Promise<DataRow[] | null>;
}

export interface SearchDataWiring {
  /** The active base; null before setup or while the config is invalid. */
  current(): Promise<string | null>;
  collections(): Record<string, Collection>;
  scoped(): boolean;
  /** The base's scopes that aren't archived. */
  scopes(base: string): Promise<string[]>;
  /** The base's one data store. */
  store(base: string): Pick<DataStore, "readAll" | "changedAt">;
  /** Absent (no plugins controller): no plugin sources. */
  plugins(): PluginSearch | null;
}

/**
 * Global search's collections (search spec D4): the harness's, then each running plugin's, of `base` only. A base that
 * isn't the active one (a profile switched under the live index), an invalid config or a plugin list that failed:
 * null, so the index keeps what it has and never takes another base's records.
 */
export function searchData(w: SearchDataWiring): SearchDataDeps {
  const isCurrent = async (base: string) => (await w.current().catch(() => null)) === base;
  return {
    sources: async (base) => {
      if (!(await isCurrent(base))) return null;
      const own = await harnessSources({ base, collections: w.collections(), scoped: w.scoped(), scopes: () => w.scopes(base) });
      const plugins = w.plugins();
      const theirs = plugins ? await plugins.searchSources(base) : [];
      // Checked again: the base may have switched during the reads.
      if (theirs === null || !(await isCurrent(base))) return null;
      return [...own, ...theirs];
    },
    rows: async (s, base) => {
      if (!(await isCurrent(base))) return null;
      if (s.owner === "plugin") return s.plugin ? (w.plugins()?.searchRows(s.plugin, s.collection, base) ?? null) : [];
      return harnessRows(w.store(base), w.collections(), s);
    },
  };
}

/** A write to `name` matters to search only when that collection opted in with `search`. */
export function searchableCollection(collections: Record<string, Collection>, name: string): boolean {
  return Object.hasOwn(collections, name) && collections[name].search !== undefined;
}

/** The plugins that run, with their versions: a view that changes only a sync time or an error gives the same text. */
export function runningPlugins(view: PluginsView): string {
  return view.plugins
    .filter((p) => p.status === "on")
    .map((p) => `${p.id}@${p.version}`)
    .sort()
    .join("\n");
}
