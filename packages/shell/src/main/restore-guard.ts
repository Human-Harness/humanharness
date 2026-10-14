export interface RestoreDeps {
  quitting(): boolean;
  /** A task operation or a turn is under way. */
  busy(): boolean;
  /** Why turns are held (engine change, folder move, engine update), or null. */
  turnBlocked(): string | null;
}

/**
 * Going back in the history against turns: one restore at a time, refused while a turn runs or turns are
 * held, and new turns held from its first moment until it ends. Every check and flag change happens
 * synchronously, so a send and a restore can't both pass their checks.
 */
export class RestoreGuard {
  private pending = false;
  private last: Promise<unknown> = Promise.resolve();

  constructor(private readonly d: RestoreDeps) {}

  /** Why a turn can't start now because of a restore, or null when it can. */
  turnBlocked(): string | null {
    return this.pending ? "Going back to an earlier point" : null;
  }

  /** Settles once the last restore has finished (a runtime starting waits for it). */
  settled(): Promise<unknown> {
    return this.last;
  }

  /** Finds the history with `history`, then runs `fn` on it; the checks are made again after that await. */
  async run<H>(history: () => Promise<H | null>, fn: (history: H) => Promise<unknown>): Promise<void> {
    this.check();
    if (this.pending) throw new Error("Already going back");
    this.pending = true;
    try {
      const h = await history();
      if (!h) throw new Error("The app is not set up yet");
      // An engine or folder change may have begun while the history was found.
      this.check();
      const done = fn(h);
      this.last = done.catch(() => undefined);
      await done;
    } finally {
      this.pending = false;
    }
  }

  private check(): void {
    if (this.d.quitting()) throw new Error("The app is closing");
    if (this.d.busy() || this.d.turnBlocked()) throw new Error("A turn is running");
  }
}

/**
 * Opens a value per key, keeping the last one while the key stays the same (one History per folder, so its
 * queue orders every write to that git data). A failed open is not kept.
 */
export function lastOpened<T>(open: (key: string) => Promise<T>): (key: string) => Promise<T> {
  let current: { key: string; value: Promise<T> } | null = null;
  return (key) => {
    if (current?.key === key) return current.value;
    const value = open(key);
    const entry = { key, value };
    current = entry;
    value.catch(() => {
      if (current === entry) current = null;
    });
    return value;
  };
}
