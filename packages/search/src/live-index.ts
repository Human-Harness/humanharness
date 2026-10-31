import MiniSearch from "minisearch";
import { indexOptions } from "./options";
import { type QueryOptions, type QueryResult, runQuery } from "./query";
import type { IndexState, Kind, SearchDoc, SearchHit, StoredDoc } from "./types";

/**
 * The seam D6 leaves for later: a retrieval context policy or a tool asks this, and the task manager runs it
 * (policies decide, never execute). Plan 1's only caller is the palette.
 */
export interface SearchIndex {
  query(q: string, opts: { scopes?: string[]; kinds?: Kind[]; limit: number }): SearchHit[];
  status(): IndexState;
}

/** The one `MiniSearch` instance main holds (§4.3): the worker's batches go in, queries come out. */
export class LiveIndex implements SearchIndex {
  private state: IndexState = { state: "empty", done: 0, total: 0 };

  private constructor(private readonly ms: MiniSearch<SearchDoc>) {}

  static empty(): LiveIndex {
    return new LiveIndex(new MiniSearch<SearchDoc>(indexOptions()));
  }

  /** A snapshot from `toJSON`; null when it can't be read (the index is rebuilt, §4.1). */
  static fromJSON(json: string): LiveIndex | null {
    try {
      return new LiveIndex(MiniSearch.loadJSON<SearchDoc>(json, indexOptions()));
    } catch {
      return null;
    }
  }

  toJSON(): string {
    return JSON.stringify(this.ms);
  }

  get size(): number {
    return this.ms.documentCount;
  }

  has(id: string): boolean {
    return this.ms.has(id);
  }

  stored(id: string): StoredDoc | null {
    if (!this.ms.has(id)) return null;
    const f = this.ms.getStoredFields(id);
    return f ? ({ id, ...f } as StoredDoc) : null;
  }

  upsert(docs: readonly SearchDoc[]): void {
    for (const d of docs) {
      if (this.ms.has(d.id)) this.ms.replace(d);
      else this.ms.add(d);
    }
  }

  remove(ids: Iterable<string>): void {
    for (const id of ids) if (this.ms.has(id)) this.ms.discard(id);
  }

  setStatus(s: IndexState): void {
    this.state = s;
  }

  status(): IndexState {
    return this.state;
  }

  search(q: string, opts: QueryOptions = {}): QueryResult {
    return runQuery(this.ms, q, opts);
  }

  query(q: string, opts: { scopes?: string[]; kinds?: Kind[]; limit: number }): SearchHit[] {
    return runQuery(this.ms, q, opts).hits.slice(0, opts.limit);
  }
}
