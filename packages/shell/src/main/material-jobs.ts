export interface MaterialJobsDeps<J> {
  /** No person's turn or task operation, no hold, not quitting (material spec §10: the queue never starts a stage then). */
  idle(): boolean;
  /** The next job in the current base; null: nothing to do. */
  next(): Promise<J | null>;
  run(job: J, signal: AbortSignal): Promise<void>;
  pollMs?: number;
}

/**
 * Runs material stages one at a time (material spec §10). It waits while the person works, starts a stage only when
 * idle, and stops when `stop()` is called (closeRuntime: an engine change, a folder change or move, a profile switch,
 * quitting). `kick()` starts it again; it ends on its own when there is nothing to do.
 */
export class MaterialJobs<J> {
  private loop: Promise<void> | null = null;
  private controller: AbortController | null = null;
  /** Bumped by `stop()`: a loop from before it ends, even while it waits for the person (a kick can't revive it). */
  private epoch = 0;
  /** A kick came while a loop ran: look for work once more when it ends. */
  private again = false;

  constructor(private readonly d: MaterialJobsDeps<J>) {}

  kick(): void {
    if (this.loop) {
      this.again = true;
      return;
    }
    this.again = false;
    this.loop = this.run(this.epoch).finally(() => {
      this.loop = null;
      if (this.again) this.kick();
    });
  }

  private async run(epoch: number): Promise<void> {
    const live = () => epoch === this.epoch;
    while (live()) {
      while (!this.d.idle()) {
        if (!live()) return;
        await new Promise((r) => setTimeout(r, this.d.pollMs ?? 1000));
      }
      if (!live()) return;
      const job = await this.d.next().catch((err: unknown) => {
        console.error("Could not look for material work", err);
        return null;
      });
      if (!job || !live()) return;
      // Finding the job may take a while (an original changed by hand is converted again): a turn that started
      // meanwhile comes first, and the job is looked for again once it ends.
      if (!this.d.idle()) continue;
      const controller = new AbortController();
      this.controller = controller;
      try {
        await this.d.run(job, controller.signal);
      } catch (err) {
        console.error("A material stage failed", err);
      } finally {
        this.controller = null;
      }
    }
  }

  /** Stops the running stage (its session ends) and waits; nothing runs until the next kick. */
  async stop(): Promise<void> {
    this.epoch++;
    this.again = false;
    this.controller?.abort();
    await this.loop;
  }

  /** Resolves once the queue has nothing to do (tests). */
  async settled(): Promise<void> {
    while (this.loop) await this.loop;
  }
}
