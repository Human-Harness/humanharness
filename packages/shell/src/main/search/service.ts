// Global search in main (search spec §4, §5, §9): lazy (D8), one live index per base, the worker's batches applied here.
import path from "node:path";
import type { SearchAnswer, SearchFilters, SearchGroup, SearchHitView, SearchIndexKind, SearchMarked, SearchStatus } from "@humanharness/protocol";
import {
  APP_SCOPE,
  type ChatMeta,
  type DataMeta,
  type DataRow,
  type DataSource,
  FOLDER_ROOT,
  type FileMeta,
  INDEX_KINDS,
  LiveIndex,
  MAX_DATA_DOCS,
  type SearchDoc,
  type SearchHit,
  dataDocs,
  docIdFor,
  fileKey,
  headingAnchorAt,
  isMarkdown,
  isRefRoot,
  recordKeyText,
  refRoot,
  secretShaped,
  snippetAround,
  splitKey,
  withoutSecretLines,
} from "@humanharness/search";
import type { BuildJob, BuildLimits, BuildMessage } from "./build";
import { readChatEntry, readText } from "./read";
import type { BuildRunner } from "./runner";
import { IndexStore, type Snapshot, searchDir } from "./store";
import { hitView } from "./views";

export const RECONCILE_EVERY_MS = 60_000;
/** After whole builds that failed in a row the wait doubles each time, up to this (a folder that always runs out of memory). */
export const MAX_RECONCILE_WAIT_MS = 30 * 60_000;
/** While typing, the tasks built in memory are rebuilt at most this often (on open they always are). */
export const MEMORY_FRESH_MS = 5_000;
export const PER_GROUP = 5;
export const PER_KIND = 50;
export const MAX_RECENT = 8;
/** Snippets read per answer (plan deviation 17). */
export const MAX_SNIPPETS = 20;
/** A searchable collection that failed to read (same stamp) is tried again after this, then twice as long each time. */
export const DATA_RETRY_MS = 10_000;

export interface SearchReference {
  id: string;
  label: string;
  /** Absolute; never sent to the window. */
  path: string;
}

/**
 * Searchable collections (D4), read through main's stores. `rows` gives a collection's records as `recordRows` maps
 * them (key checked, text capped, one row per key). Absent (tests of plan 1): no data documents.
 */
export interface SearchDataDeps {
  sources(): Promise<DataSource[]>;
  rows(source: DataSource): Promise<DataRow[]>;
}

export interface SearchServiceDeps {
  userData(): string;
  /** The active base (the folder, or the active profile's folder); null before setup. */
  base(): Promise<string | null>;
  scoped(): boolean;
  openScope(): Promise<string | null>;
  scopeTitles(): Promise<Map<string, string>>;
  references(): Promise<SearchReference[]>;
  /** Actions, the open task and past tasks, built now (§4.2). */
  memory(): Promise<SearchDoc[]>;
  /** The engine's generated instructions file, never indexed (§8.1). */
  extraDenied(): Promise<string[]>;
  status(s: SearchStatus): void;
  runner: BuildRunner;
  /** "Show in Finder", checked inside `roots`. */
  reveal(file: string, roots: string[]): Promise<boolean>;
  /** Searchable collections (D4); absent: none. */
  data?: SearchDataDeps;
  /** Tests: the cap on data documents (MAX_DATA_DOCS). */
  maxDataDocs?: number;
  now?: () => number;
  storeDelayMs?: number;
  limits?: BuildLimits;
}

interface Live {
  base: string;
  index: LiveIndex;
  store: IndexStore;
  files: Record<string, FileMeta>;
  chats: Record<string, ChatMeta>;
  memory: Set<string>;
  memoryAt: number;
  truncated: boolean;
  reconciledAt: number;
  /** Whole builds that failed in a row (not stopped): the next reconcile waits longer. */
  failures: number;
  building: { stop(): void; done: Promise<boolean> } | null;
  again: "full" | Set<string> | null;
  /** Each searchable collection's stamp and documents (D4). */
  data: Record<string, DataMeta>;
  dataAt: number;
  /** A data refresh under way (`dataPass`: its pass in progress); `dataAgain`: one more was asked for meanwhile. */
  dataRun: Promise<void> | null;
  dataPass: Promise<void> | null;
  dataAgain: boolean;
  /** Sources whose last read failed: at which stamp, when, and how long until the next try. */
  dataFailed: Map<string, { stamp: string; at: number; wait: number }>;
}

/** A source cut short by the cap: its stamp with the room it had, so the same room and stamp read nothing again. */
const cutStamp = (room: number, stamp: string) => `cut:${room}:${stamp}`;

const EMPTY_COUNTS = (): Record<SearchIndexKind, number> => ({ task: 0, note: 0, file: 0, data: 0 });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * A loaded snapshot without the documents its `files.json` doesn't account for: a build cut short (a quit, a crashed
 * worker) saved its batches, but files and chats only take that build's state on "done", so a reconcile would never
 * take those documents out. Null when the index can't list its documents (rebuilt then).
 */
function accounted(index: LiveIndex | null, snap: Snapshot): LiveIndex | null {
  const ids = index?.ids();
  if (!index || !ids) return null;
  const keep = new Set<string>(snap.memory);
  for (const key of Object.keys(snap.files)) {
    const { root, rel } = splitKey(key);
    keep.add(docIdFor(root, rel));
  }
  for (const c of Object.values(snap.chats)) for (const id of c.ids) keep.add(id);
  for (const m of Object.values(snap.data ?? {})) for (const id of m.ids) keep.add(id);
  const stray = ids.filter((id) => !keep.has(id));
  if (stray.length) {
    index.remove(stray);
    index.compact();
  }
  return index;
}

export class SearchService {
  private live: Live | null = null;
  private opening: { base: string; live: Promise<Live> } | null = null;
  /** A base being swapped out, its store still flushing: a discard of that base goes to this store. */
  private closing: { base: string; store: IndexStore } | null = null;

  constructor(private readonly d: SearchServiceDeps) {}

  private now(): number {
    return this.d.now?.() ?? Date.now();
  }

  /** The live index for the current base, loaded or built on first use; a base change (profile, move) swaps it. */
  private async ensure(): Promise<Live | null> {
    const base = await this.d.base();
    if (!base) return null;
    // Another base still loading (a profile switch meanwhile): let it settle, then swap it out like a loaded one.
    if (this.opening && this.opening.base !== base) await this.opening.live.catch(() => null);
    if (this.live?.base === base) return this.live;
    if (this.opening?.base === base) return this.opening.live;
    if (this.live) {
      await this.close();
      // Another caller may have started this base meanwhile.
      if (this.opening?.base === base) return this.opening.live;
      if (this.live?.base === base) return this.live;
    }
    const opening = {
      base,
      live: this.load(base).finally(() => {
        if (this.opening === opening) this.opening = null;
      }),
    };
    this.opening = opening;
    return opening.live;
  }

  private async load(base: string): Promise<Live> {
    const store = new IndexStore(searchDir(this.d.userData(), base), this.d.storeDelayMs !== undefined ? { delayMs: this.d.storeDelayMs } : {});
    const snap = await store.load();
    const index = snap ? accounted(LiveIndex.fromJSON(snap.index), snap) : null;
    const live: Live = {
      base,
      index: index ?? LiveIndex.empty(),
      store,
      files: index && snap ? snap.files : {},
      chats: index && snap ? snap.chats : {},
      memory: new Set(index && snap ? snap.memory : []),
      memoryAt: 0,
      truncated: index && snap ? snap.truncated : false,
      reconciledAt: 0,
      failures: 0,
      building: null,
      again: null,
      data: index && snap ? (snap.data ?? {}) : {},
      dataAt: 0,
      dataRun: null,
      dataPass: null,
      dataAgain: false,
      dataFailed: new Map(),
    };
    this.live = live;
    if (index) {
      const n = Object.keys(live.files).length;
      live.index.setStatus({ state: "ready", done: n, total: n, ...(live.truncated ? { truncated: true as const } : {}) });
    } else this.startBuild(live, "full");
    return live;
  }

  private async close(): Promise<void> {
    const live = this.live;
    this.live = null;
    if (!live) return;
    live.building?.stop();
    const closing = { base: live.base, store: live.store };
    this.closing = closing;
    try {
      await live.store.flush();
    } finally {
      if (this.closing === closing) this.closing = null;
    }
  }

  private setStatus(live: Live, s: SearchStatus): void {
    live.index.setStatus(s);
    this.d.status(s);
  }

  private save(live: Live): void {
    live.store.schedule(() => ({
      index: live.index.toJSON(),
      files: live.files,
      chats: live.chats,
      memory: [...live.memory],
      truncated: live.truncated,
      ...(Object.keys(live.data).length > 0 ? { data: live.data } : {}),
    }));
  }

  private apply(live: Live, m: BuildMessage): void {
    if (m.type === "names") {
      live.index.upsert(m.docs);
      this.setStatus(live, { state: "names", done: 0, total: m.total, ...(m.truncated ? { truncated: true as const } : {}) });
    } else if (m.type === "docs") {
      live.index.upsert(m.docs);
      this.setStatus(live, { state: "building", done: m.done, total: m.total });
      this.save(live);
    } else if (m.type === "removed") {
      live.index.remove(m.ids);
    } else {
      live.files = m.files;
      live.chats = m.chats;
      if (m.truncated !== undefined) live.truncated = m.truncated;
      // The build's replaced and removed documents leave the tree now, in one go, before the save (LiveIndex.compact).
      live.index.compact();
      const n = Object.keys(m.files).length;
      this.setStatus(live, { state: "ready", done: n, total: n, ...(live.truncated ? { truncated: true as const } : {}) });
      this.save(live);
    }
  }

  private async job(live: Live, what: "full" | Set<string>): Promise<BuildJob> {
    const refs = await this.d.references();
    return {
      roots: [{ key: FOLDER_ROOT, path: live.base }, ...refs.map((r) => ({ key: refRoot(r.id), path: r.path }))],
      scoped: this.d.scoped(),
      known: live.files,
      chats: live.chats,
      ...(what === "full" ? {} : { only: [...what] }),
      extraDenied: await this.d.extraDenied(),
      ...(this.d.limits ? { limits: this.d.limits } : {}),
    };
  }

  /** One build at a time; what comes in meanwhile runs right after (a full reconcile absorbs a commit's paths). */
  private startBuild(live: Live, what: "full" | Set<string>): void {
    // A caller still holding an index swapped out or discarded meanwhile: nothing would take the build's batches.
    if (this.live !== live) return;
    if (live.building) {
      live.again = what === "full" || live.again === "full" ? "full" : new Set([...(live.again ?? []), ...what]);
      return;
    }
    if (what === "full") live.reconciledAt = this.now();
    let stopped = false;
    let handle: { stop(): void } | null = null;
    const done = (async () => {
      const job = await this.job(live, what);
      if (stopped) return false;
      const run = this.d.runner(job, (m) => {
        if (this.live === live && !stopped) this.apply(live, m);
      });
      handle = run;
      return run.done;
    })().catch((err: unknown) => {
      console.error("Could not build the search index", err instanceof Error ? err.message : "unknown error");
      return false;
    });
    live.building = {
      done,
      stop: () => {
        stopped = true;
        handle?.stop();
      },
    };
    void done.then((ok) => {
      if (live.building?.done === done) live.building = null;
      if (what === "full" && !stopped && this.live === live) live.failures = ok ? 0 : live.failures + 1;
      if (!ok && !stopped && this.live === live) {
        // The index keeps what it has; the status leaves "building" (D8 has no failed state), from the files last known.
        const n = Object.keys(live.files).length;
        this.setStatus(live, { state: "ready", done: n, total: n, ...(live.truncated ? { truncated: true as const } : {}) });
        console.error("Could not finish the search index build; the next reconcile waits", `${this.reconcileWait(live) / 1000} s`);
      }
      const next = live.again;
      live.again = null;
      if (next && this.live === live && !stopped) this.startBuild(live, next);
    });
  }

  private reconcileWait(live: Live): number {
    return Math.min(RECONCILE_EVERY_MS * 2 ** live.failures, MAX_RECONCILE_WAIT_MS);
  }

  private maybeReconcile(live: Live): void {
    if (!live.building && this.now() - live.reconciledAt >= this.reconcileWait(live)) this.startBuild(live, "full");
  }

  /** Swaps the tasks built in memory (§4.2). Not saved on its own: the next build's save carries them. */
  private async refreshMemory(live: Live): Promise<void> {
    const docs = await this.d.memory().catch((err: unknown) => {
      console.error("Could not list the tasks for search", err instanceof Error ? err.message : "unknown error");
      return [] as SearchDoc[];
    });
    const ids = new Set(docs.map((doc) => doc.id));
    live.index.remove([...live.memory].filter((id) => !ids.has(id)));
    live.index.upsert(docs);
    live.index.compact();
    live.memory = ids;
    live.memoryAt = this.now();
  }

  /**
   * Searchable collections (D4): one refresh at a time; one asked for meanwhile runs once more after it. What it
   * returns settles with the pass in progress: an answer never waits for the passes a burst of writes keeps asking for.
   */
  private refreshData(live: Live): Promise<void> {
    // Like a build: an index swapped out or discarded meanwhile reads nothing.
    if (!this.d.data || this.live !== live) return Promise.resolve();
    if (live.dataRun) {
      live.dataAgain = true;
      return live.dataPass ?? live.dataRun;
    }
    let run: Promise<void> | null = null;
    run = (async () => {
      try {
        do {
          live.dataAgain = false;
          live.dataPass = this.syncData(live).catch((err: unknown) =>
            console.error("Could not refresh the searchable collections", err instanceof Error ? err.message : "unknown error"),
          );
          await live.dataPass;
        } while (live.dataAgain && this.live === live);
      } finally {
        // Here, not in a chained handler: a refresh asked for after the last check above starts a new run.
        if (live.dataRun === run) {
          live.dataRun = null;
          live.dataPass = null;
        }
      }
    })();
    live.dataRun = run;
    return live.dataPass ?? run;
  }

  /**
   * A source whose stamp changed is read again (one at a time) and its documents replaced; one gone takes its documents
   * out; one that fails keeps what the index had (while it fits), logged once per stamp and tried again later and later.
   * At most MAX_DATA_DOCS documents in all (plan deviation 5). Nothing is applied to an index swapped out or discarded
   * during a read.
   */
  private async syncData(live: Live): Promise<void> {
    const data = this.d.data!;
    const sources = await data.sources().catch((err: unknown) => {
      console.error("Could not list the searchable collections", err instanceof Error ? err.message : "unknown error");
      return null;
    });
    if (this.live !== live) return;
    live.dataAt = this.now();
    if (!sources) return;
    const scoped = this.d.scoped();
    const next: Record<string, DataMeta> = {};
    let room = this.d.maxDataDocs ?? MAX_DATA_DOCS;
    let changed = false;
    const listed = new Set(sources.map((s) => s.id));
    for (const id of live.dataFailed.keys()) if (!listed.has(id)) live.dataFailed.delete(id);
    for (const s of sources) {
      // A source listed twice: the first one counts.
      if (Object.hasOwn(next, s.id)) continue;
      const had = live.data[s.id];
      if (had && (had.stamp === s.stamp || had.stamp === cutStamp(room, s.stamp)) && had.ids.length <= room) {
        next[s.id] = had;
        room -= had.ids.length;
        continue;
      }
      // No room left: left out (its documents go below), read again once there is.
      if (room <= 0) continue;
      const failed = live.dataFailed.get(s.id);
      const again = failed?.stamp === s.stamp ? failed : undefined;
      const rows =
        again && this.now() - again.at < again.wait
          ? null
          : await data.rows(s).catch((err: unknown) => {
              if (!again) console.error("Could not read a searchable collection", err instanceof Error ? err.message : "unknown error");
              live.dataFailed.set(s.id, { stamp: s.stamp, at: this.now(), wait: again ? Math.min(again.wait * 2, MAX_RECONCILE_WAIT_MS) : DATA_RETRY_MS });
              return null;
            });
      if (this.live !== live) return;
      if (rows) live.dataFailed.delete(s.id);
      if (!rows) {
        if (had && had.ids.length <= room) {
          next[s.id] = had;
          room -= had.ids.length;
        }
        continue;
      }
      const docs = dataDocs(s, rows.slice(0, room), scoped);
      const ids = new Set(docs.map((doc) => doc.id));
      if (had) live.index.remove(had.ids.filter((id) => !ids.has(id)));
      live.index.upsert(docs);
      // Cut short by the cap: read again only once its room or its stamp changes (with more room, maybe all of it).
      next[s.id] = { stamp: rows.length > room ? cutStamp(room, s.stamp) : s.stamp, ids: [...ids] };
      room -= ids.size;
      changed = true;
    }
    for (const [id, m] of Object.entries(live.data)) {
      if (Object.hasOwn(next, id)) continue;
      live.index.remove(m.ids);
      changed = true;
    }
    live.data = next;
    if (changed) {
      live.index.compact();
      this.save(live);
    }
  }

  /** A text file's or a chat entry's snippet, for a visible row only (§5.3); never a secret-shaped file's. */
  private async snippet(
    live: Live,
    hit: SearchHit,
    refPaths: Map<string, string>,
    rowsOf: Map<string, Promise<DataRow[] | null>>,
  ): Promise<{ marked: SearchMarked; anchor?: string } | null> {
    if (hit.data) {
      // A record's text is never stored (§4.1): its collection is read again, once per answer.
      const data = this.d.data;
      if (!data) return null;
      const { source, key, ...rest } = hit.data;
      let rows = rowsOf.get(source);
      if (!rows) {
        rows = data.rows({ ...rest, id: source, stamp: "" }).catch(() => null);
        rowsOf.set(source, rows);
      }
      const row = (await rows)?.find((r) => recordKeyText(r.key) === recordKeyText(key));
      const s = row ? snippetAround(row.text, hit.terms) : null;
      return s ? { marked: s.marked } : null;
    }
    if (hit.chat) {
      const text = await readChatEntry(live.base, hit.chat.file, hit.chat.offset, hit.chat.length);
      const s = text === null ? null : snippetAround(withoutSecretLines(text), hit.terms);
      return s ? { marked: s.marked } : null;
    }
    if (hit.kind === "task" || !hit.root) return null;
    if (live.files[fileKey(hit.root, hit.path)]?.how !== "text") return null;
    const root = hit.root === FOLDER_ROOT ? live.base : refPaths.get(hit.root);
    if (!root) return null;
    const raw = await readText(root, hit.path);
    if (raw === null) return null;
    // The file may have changed since it was indexed: the content check again before any of it leaves main.
    if (hit.kind === "file" && secretShaped(raw)) return null;
    const text = hit.kind === "note" ? withoutSecretLines(raw) : raw;
    const s = snippetAround(text, hit.terms);
    if (!s) return null;
    const anchor = isMarkdown(hit.path) ? headingAnchorAt(text, s.at) : undefined;
    return { marked: s.marked, ...(anchor ? { anchor } : {}) };
  }

  private async views(live: Live, hits: SearchHit[], open: string | null, snippets: boolean): Promise<SearchHitView[]> {
    const refs = await this.d.references();
    const refLabels = new Map(refs.map((r) => [refRoot(r.id), r.label]));
    const refPaths = new Map(refs.map((r) => [refRoot(r.id), r.path]));
    const scoped = this.d.scoped();
    const titles = scoped ? await this.d.scopeTitles() : new Map<string, string>();
    const scopeTitle = (s: string) => (scoped && s !== APP_SCOPE && s !== open ? (titles.get(s) ?? s) : undefined);
    const out: SearchHitView[] = [];
    const rowsOf = new Map<string, Promise<DataRow[] | null>>();
    let read = 0;
    for (const hit of hits) {
      const snippet = snippets && hit.terms.length > 0 && read++ < MAX_SNIPPETS ? await this.snippet(live, hit, refPaths, rowsOf).catch(() => null) : null;
      out.push(hitView(hit, { refLabels, scopeTitle, ...(snippet ? { snippet } : {}) }));
    }
    return out;
  }

  async query(q: string, filters: SearchFilters): Promise<SearchAnswer> {
    const live = await this.ensure();
    if (!live) return { ok: false, reason: "not-ready" };
    const prefs = await live.store.prefs();
    let allScopes = prefs.allScopes;
    if (typeof filters.allScopes === "boolean" && filters.allScopes !== allScopes) {
      allScopes = filters.allScopes;
      // Remembered at once; the answer doesn't wait for the disk (it may be behind a long snapshot write).
      void live.store.updatePrefs((p) => ({ ...p, allScopes })).catch((err: unknown) => console.error("Could not save the search prefs", err instanceof Error ? err.message : "unknown error"));
    }
    const scoped = this.d.scoped();
    const open = scoped ? await this.d.openScope() : null;
    const empty = !q.trim();
    if (empty || this.now() - live.memoryAt > MEMORY_FRESH_MS) await this.refreshMemory(live);
    if (empty || this.now() - live.dataAt > MEMORY_FRESH_MS) await this.refreshData(live);
    // On open (§4.1), and on a loaded snapshot's first search whatever it asks (the palette may open with a query).
    if (empty || live.reconciledAt === 0) this.maybeReconcile(live);
    const base = { ok: true as const, query: q, groups: [] as SearchGroup[], counts: EMPTY_COUNTS(), recent: [] as SearchHitView[], partial: false, allScopes };
    if (empty) {
      const stored = prefs.recent.flatMap((id) => {
        const s = live.index.stored(id);
        return s ? [{ ...s, score: 0, terms: [] }] : [];
      });
      return { ...base, recent: await this.views(live, stored, open, false), status: live.index.status() };
    }
    const scopes = scoped && !allScopes ? [APP_SCOPE, ...(open ? [open] : [])] : undefined;
    const { hits, partial } = live.index.search(q, { ...(scopes ? { scopes } : {}), references: filters.references !== false, openScope: open, now: this.now() });
    const counts = EMPTY_COUNTS();
    for (const h of hits) counts[h.kind]++;
    const chosen = filters.kind ? hits.filter((h) => h.kind === filters.kind).slice(0, PER_KIND) : INDEX_KINDS.flatMap((k) => hits.filter((h) => h.kind === k).slice(0, PER_GROUP));
    const views = await this.views(live, chosen, open, true);
    const groups = INDEX_KINDS.filter((k) => !filters.kind || k === filters.kind)
      .map((k) => ({ kind: k, total: counts[k], hits: views.filter((v) => v.kind === k) }))
      .filter((g) => g.hits.length > 0);
    return { ...base, groups, counts, partial, status: live.index.status() };
  }

  /** The person opened a result (Enter): it goes first among the recents; a reference folder's file shows in Finder. */
  async opened(raw: unknown): Promise<{ ok: boolean }> {
    const id = isObject(raw) && typeof raw.id === "string" && raw.id.length <= 2000 ? raw.id : null;
    if (!id) return { ok: false };
    const live = await this.ensure();
    const stored = live?.index.stored(id);
    if (!live || !stored) return { ok: false };
    await live.store.updatePrefs((p) => ({ ...p, recent: [id, ...p.recent.filter((r) => r !== id)].slice(0, MAX_RECENT) }));
    if (stored.kind === "file" && isRefRoot(stored.root) && !isMarkdown(stored.path)) {
      const ref = (await this.d.references()).find((r) => refRoot(r.id) === stored.root);
      if (!ref) return { ok: false };
      return { ok: await this.d.reveal(path.join(ref.path, stored.path), [ref.path]) };
    }
    return { ok: true };
  }

  /** A commit touched `paths` (null: too many, or a restore). Nothing at all until search was first opened (D0). */
  committed(paths: string[] | null): void {
    const live = this.live;
    if (!live) return;
    this.startBuild(live, paths === null ? "full" : new Set(paths));
    // The walk never reads .harness/data/ (plan 1 deviation 15); its collections come through the stores.
    if (paths === null || paths.some((p) => p.replaceAll("\\", "/").startsWith(".harness/data/"))) this.dataChanged();
  }

  /** A searchable collection changed (a write, a plugin run, a plugin on or off). Nothing until search was opened (D0). */
  dataChanged(): void {
    const live = this.live;
    if (!live || !this.d.data) return;
    void this.refreshData(live);
  }

  /** Settles once no build and no data refresh runs (tests, and a measured build). */
  async whenIdle(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const b = this.live?.building;
      const r = this.live?.dataRun;
      if (!b && !r) return;
      if (b) await b.done;
      if (r) await r;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  /** On quit (§4.1 "once more on quit"): the build stops, the snapshot is written. */
  async flush(): Promise<void> {
    const live = this.live;
    if (!live) return;
    live.building?.stop();
    await live.store.flush();
  }

  /** The folder moved (plan deviation 2): the old base's index goes; the next ⌘K rebuilds. */
  async discard(base: string): Promise<void> {
    // A load under way for this base settles first: it would set the live index after this and save into the folder.
    if (this.opening?.base === base) await this.opening.live.catch(() => null);
    const live = this.live?.base === base ? this.live : null;
    if (live) {
      live.building?.stop();
      this.live = null;
    }
    // The live store's own discard (or the one a base switch is still flushing), so a save it still has scheduled is
    // dropped instead of bringing the folder back.
    const closing = this.closing?.base === base ? this.closing.store : null;
    await (live?.store ?? closing ?? new IndexStore(searchDir(this.d.userData(), base))).discard();
  }
}
