/** An engine that doesn't report its compactions: the context falling below this share of the last reading means one happened (spec §7.2). */
export const COMPACTED_DROP = 0.5;

/**
 * Infers a compaction from the context in use, for adapters whose engine doesn't always report one. Seeded with the
 * last reading of a resumed session (`CommonOptions.lastContextUsed`); `reset` for a new session.
 */
export class ContextDrop {
  constructor(private last?: number) {}

  /** Takes the next reading; true when it fell below `COMPACTED_DROP` of the previous one. */
  next(used: number): boolean {
    const prev = this.last;
    this.last = used;
    return prev !== undefined && used < prev * COMPACTED_DROP;
  }

  /** A new session: the next reading has nothing to compare with. */
  reset(): void {
    this.last = undefined;
  }
}
