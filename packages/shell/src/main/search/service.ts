// Global search in main (search spec §4, §5, §9): lazy (D8), one live index per base, the worker's batches applied here.
import path from "node:path";
import type { SearchAnswer, SearchFilters, SearchGroup, SearchHitView, SearchKind, SearchMarked, SearchStatus } from "@humanharness/protocol";
import {
  APP_SCOPE,
  type ChatMeta,
  FOLDER_ROOT,
  type FileMeta,
  KINDS,
  LiveIndex,
  type SearchDoc,
  type SearchHit,
  fileKey,
  headingAnchorAt,
  isMarkdown,
  isRefRoot,
  refRoot,
  secretShaped,
  snippetAround,
  withoutSecretLines,
} from "@humanharness/search";
import type { BuildJob, BuildLimits, BuildMessage } from "./build";
import { readChatEntry, readText } from "./read";
import type { BuildRunner } from "./runner";
import { IndexStore, searchDir } from "./store";
import { hitView } from "./views";

export const RECONCILE_EVERY_MS = 60_000;
/** While typing, the tasks built in memory are rebuilt at most this often (on open they always are). */
export const MEMORY_FRESH_MS = 5_000;
export const PER_GROUP = 5;
export const PER_KIND = 50;
export const MAX_RECENT = 8;
/** Snippets read per answer (plan deviation 17). */
export const MAX_SNIPPETS = 20;

export interface SearchReference {
  id: string;
  label: string;
  /** Absolute; never sent to the window. */
  path: string;
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
  building: { stop(): void; done: Promise<boolean> } | null;
  again: "full" | Set<string> | null;
}

const EMPTY_COUNTS = (): Record<SearchKind, number> => ({ task: 0, note: 0, file: 0 });
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export class SearchService {
  private live: Live | null = null;
  private opening: { base: string; live: Promise<Live> } | null = null;

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
    const index = snap ? LiveIndex.fromJSON(snap.index) : null;
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
      building: null,
      again: null,
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
    live?.building?.stop();
    await live?.store.flush();
  }

  private setStatus(live: Live, s: SearchStatus): void {
    live.index.setStatus(s);
    this.d.status(s);
  }

  private save(live: Live): void {
    live.store.schedule(() => ({ index: live.index.toJSON(), files: live.files, chats: live.chats, memory: [...live.memory], truncated: live.truncated }));
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
    void done.then(() => {
      if (live.building?.done === done) live.building = null;
      const next = live.again;
      live.again = null;
      if (next && this.live === live && !stopped) this.startBuild(live, next);
    });
  }

  private maybeReconcile(live: Live): void {
    if (!live.building && this.now() - live.reconciledAt >= RECONCILE_EVERY_MS) this.startBuild(live, "full");
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

  /** A text file's or a chat entry's snippet, for a visible row only (§5.3); never a secret-shaped file's. */
  private async snippet(live: Live, hit: SearchHit, refPaths: Map<string, string>): Promise<{ marked: SearchMarked; anchor?: string } | null> {
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
    let read = 0;
    for (const hit of hits) {
      const snippet = snippets && hit.terms.length > 0 && read++ < MAX_SNIPPETS ? await this.snippet(live, hit, refPaths).catch(() => null) : null;
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
      await live.store.savePrefs({ ...prefs, allScopes });
    }
    const scoped = this.d.scoped();
    const open = scoped ? await this.d.openScope() : null;
    const empty = !q.trim();
    if (empty || this.now() - live.memoryAt > MEMORY_FRESH_MS) await this.refreshMemory(live);
    const base = { ok: true as const, query: q, groups: [] as SearchGroup[], counts: EMPTY_COUNTS(), recent: [] as SearchHitView[], partial: false, allScopes };
    if (empty) {
      this.maybeReconcile(live);
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
    const chosen = filters.kind ? hits.filter((h) => h.kind === filters.kind).slice(0, PER_KIND) : KINDS.flatMap((k) => hits.filter((h) => h.kind === k).slice(0, PER_GROUP));
    const views = await this.views(live, chosen, open, true);
    const groups = KINDS.filter((k) => !filters.kind || k === filters.kind)
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
    const prefs = await live.store.prefs();
    await live.store.savePrefs({ ...prefs, recent: [id, ...prefs.recent.filter((r) => r !== id)].slice(0, MAX_RECENT) });
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
  }

  /** Settles once no build runs (tests, and a measured build). */
  async whenIdle(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      const b = this.live?.building;
      if (!b) return;
      await b.done;
      await new Promise((r) => setImmediate(r));
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
    const live = this.live?.base === base ? this.live : null;
    if (live) {
      live.building?.stop();
      this.live = null;
    }
    // The live store's own discard, so a save it still has scheduled is dropped instead of bringing the folder back.
    await (live?.store ?? new IndexStore(searchDir(this.d.userData(), base))).discard();
  }
}
