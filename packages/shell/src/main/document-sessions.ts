/** What `DocumentSessions` needs from `DocumentWatchers` (./documents). */
export interface WatcherPool {
  watch(rel: unknown, roots: string[]): Promise<number | null>;
  unwatch(id: unknown): void;
  closeAll(): void;
  /** Set by `DocumentSessions`: a watch the pool ended by itself (made room, or its watcher failed). */
  onClosed?: ((id: number) => void) | null;
}

/**
 * The reader's watches by owner (a window's webContents id, document-reader spec §5.3): a window can only unwatch
 * its own ids, its watches end when it closes or reloads, and every watch ends when the roots (the person's folder,
 * the reference folders) change: a watch never outlives the folder it was checked against.
 *
 * Whenever a watch ends without its window asking (`closeAll`, `closeOwner`, or the pool closing it to make room or
 * after a failure), `ended(owner, id)` tells that window, so it can watch again and keep reloading live.
 */
export class DocumentSessions {
  private readonly owners = new Map<number, number>();
  private roots: string | null = null;
  /** Bumped by `closeAll`: a watch that was being set up meanwhile is closed as soon as it is made. */
  private generation = 0;
  /** Bumped by `closeOwner`: a watch one window was setting up before it reloaded is not given to the new page. */
  private readonly ownerGenerations = new Map<number, number>();

  constructor(
    private readonly pool: WatcherPool,
    private readonly ended: (owner: number, id: number) => void = () => undefined,
  ) {
    pool.onClosed = (id) => this.end(id);
  }

  /** Who asked for watch `id`; null when nobody (closed, or never made). */
  ownerOf(id: number): number | null {
    return this.owners.get(id) ?? null;
  }

  async watch(owner: number, rel: unknown, roots: string[]): Promise<number | null> {
    const key = JSON.stringify(roots);
    if (this.roots !== null && this.roots !== key) this.closeAll();
    this.roots = key;
    const generation = this.generation;
    const ownerGeneration = this.ownerGenerations.get(owner) ?? 0;
    const id = await this.pool.watch(rel, roots);
    if (id === null) return null;
    if (generation !== this.generation || ownerGeneration !== (this.ownerGenerations.get(owner) ?? 0)) {
      this.pool.unwatch(id);
      return null;
    }
    this.owners.set(id, owner);
    return id;
  }

  /** Ends watch `id` only when `owner` made it. The window asked: it is not told. */
  unwatch(owner: number, id: unknown): void {
    if (typeof id !== "number" || this.owners.get(id) !== owner) return;
    this.owners.delete(id);
    this.pool.unwatch(id);
  }

  /** Every watch of one window (it closed or reloaded). */
  closeOwner(owner: number): void {
    this.ownerGenerations.set(owner, (this.ownerGenerations.get(owner) ?? 0) + 1);
    for (const [id, o] of [...this.owners]) {
      if (o !== owner) continue;
      this.pool.unwatch(id);
      this.end(id);
    }
  }

  /** Every watch (the folder or the reference folders changed). */
  closeAll(): void {
    this.generation++;
    this.roots = null;
    this.pool.closeAll();
    for (const id of [...this.owners.keys()]) this.end(id);
  }

  /** Watch `id` is gone: its window hears so, once. */
  private end(id: number): void {
    const owner = this.owners.get(id);
    if (owner === undefined) return;
    this.owners.delete(id);
    this.ended(owner, id);
  }
}
