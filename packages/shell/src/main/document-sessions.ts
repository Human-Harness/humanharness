/** What `DocumentSessions` needs from `DocumentWatchers` (./documents). */
export interface WatcherPool {
  watch(rel: unknown, roots: string[]): Promise<number | null>;
  unwatch(id: unknown): void;
  closeAll(): void;
}

/**
 * The reader's watches by owner (a window's webContents id, document-reader spec §5.3): a window can only unwatch
 * its own ids, its watches end when it closes or reloads, and every watch ends when the roots (the person's folder,
 * the reference folders) change: a watch never outlives the folder it was checked against.
 */
export class DocumentSessions {
  private readonly owners = new Map<number, number>();
  private roots: string | null = null;
  /** Bumped by `closeAll`: a watch that was being set up meanwhile is closed as soon as it is made. */
  private generation = 0;

  constructor(private readonly pool: WatcherPool) {}

  /** Who asked for watch `id`; null when nobody (closed, or never made). */
  ownerOf(id: number): number | null {
    return this.owners.get(id) ?? null;
  }

  async watch(owner: number, rel: unknown, roots: string[]): Promise<number | null> {
    const key = JSON.stringify(roots);
    if (this.roots !== null && this.roots !== key) this.closeAll();
    this.roots = key;
    const generation = this.generation;
    const id = await this.pool.watch(rel, roots);
    if (id === null) return null;
    if (generation !== this.generation) {
      this.pool.unwatch(id);
      return null;
    }
    this.owners.set(id, owner);
    return id;
  }

  /** Ends watch `id` only when `owner` made it. */
  unwatch(owner: number, id: unknown): void {
    if (typeof id !== "number" || this.owners.get(id) !== owner) return;
    this.owners.delete(id);
    this.pool.unwatch(id);
  }

  /** Every watch of one window (it closed or reloaded). */
  closeOwner(owner: number): void {
    for (const [id, o] of [...this.owners]) if (o === owner) this.unwatch(o, id);
  }

  /** Every watch (the folder or the reference folders changed). */
  closeAll(): void {
    this.generation++;
    this.owners.clear();
    this.roots = null;
    this.pool.closeAll();
  }
}
