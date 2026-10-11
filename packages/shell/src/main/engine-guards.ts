import type { SetupStep } from "@humanharness/ui/client";

export interface SwitchDeps {
  /** A turn is starting or running. */
  isBusy(): boolean;
  /** Resolves once the current turn has ended. */
  idle(): Promise<void>;
  /** Saves the config with the new engine. */
  save(): Promise<void>;
  dropRuntime(): Promise<void>;
  /** Archives the chat when it belongs to another engine; returns that engine's id. */
  archiveChat(): Promise<string | null>;
}

/**
 * What may run at the same time in the main process: engine changes, setup steps and test prompts
 * against turns. Every check and flag change happens synchronously, so two IPC calls can't both
 * pass a check before either sets its flag.
 */
export class EngineGuards {
  private switching = false;
  private switchedFrom: string | null = null;
  /** The install, update, login or logout running now, if any (one at a time), and for which engine. */
  setup: { engineId: string; step: SetupStep } | null = null;
  /** The running step is a logout or update of the engine in use: turns wait for it. */
  private setupBlocksTurns = false;
  private test: { engineId: string; controller: AbortController; result: Promise<unknown> } | null = null;
  /** The user cancelled the running setup step (maybe before its process started). */
  private setupCancel = false;

  /** Why a turn can't start now, or null when it can. */
  turnBlocked(): string | null {
    if (this.switching) return "The engine is being changed";
    if (this.setupBlocksTurns) return "The engine is being updated or signed out";
    return null;
  }

  /**
   * Changes the engine: turns are refused from the first moment; the config is saved, then the old
   * runtime is closed and the old engine's chat archived. Returns the engine whose chat was archived.
   * Only a failed save rejects; later failures go to `onError`.
   */
  async switchEngine(d: SwitchDeps, onError: (err: unknown) => void = () => {}): Promise<string | null> {
    if (this.switching) throw new Error("The engine is already being changed");
    if (this.setup?.step === "logout" || this.setup?.step === "update") throw new Error("An engine is being updated or signed out");
    if (d.isBusy()) throw new Error("A turn is running");
    this.switching = true;
    try {
      await d.save();
      // From here the new engine is saved: a failure below is reported, never thrown, so the app
      // and the window agree on the engine. The next chat load archives the old chat if this didn't.
      if (d.isBusy()) await d.idle().catch(onError);
      await d.dropRuntime().catch(onError);
      const from = await d.archiveChat().catch((err: unknown) => {
        onError(err);
        return null;
      });
      if (from) this.switchedFrom = from;
      return from;
    } finally {
      this.switching = false;
    }
  }

  /** The engine whose chat the last change archived, once (for the next chat load). */
  takeSwitchedFrom(): string | null {
    const from = this.switchedFrom;
    this.switchedFrom = null;
    return from;
  }

  /**
   * Reserves the setup slot. A logout or update of the engine in use (`current`) also needs no turn
   * running, and blocks turns until it ends (it pulls the CLI from under them).
   */
  beginSetup(run: { engineId: string; step: SetupStep; current: boolean }, isBusy: () => boolean): void {
    if (this.setup) throw new Error("A setup step is already running");
    if (this.switching) throw new Error("The engine is being changed");
    const blocks = run.current && (run.step === "logout" || run.step === "update");
    if (blocks && isBusy()) throw new Error("A turn is running");
    this.setup = { engineId: run.engineId, step: run.step };
    this.setupBlocksTurns = blocks;
    this.setupCancel = false;
  }

  endSetup(): void {
    this.setup = null;
    this.setupBlocksTurns = false;
    this.setupCancel = false;
  }

  /**
   * Records that the user cancelled the running step, so a step whose process hasn't started yet
   * (it is still finding the CLI) ends instead of starting it. False when no step runs.
   */
  cancelSetup(): boolean {
    if (!this.setup) return false;
    this.setupCancel = true;
    return true;
  }

  /** The user cancelled the running step. */
  setupCancelled(): boolean {
    return this.setupCancel;
  }

  /**
   * Runs the test prompt for `engineId`, one at a time. A second request for the same engine (e.g.
   * the screen was reopened while it runs) gets the running one's result instead of a failure; one
   * for another engine waits for it to end. The signal aborts it (e.g. on quit).
   */
  async runTest<T>(engineId: string, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
    for (let current = this.test; current; current = this.test) {
      if (current.engineId === engineId) return current.result as Promise<T>;
      await current.result.catch(() => undefined);
    }
    const controller = new AbortController();
    // Started after the slot is taken, so nothing can slip in between.
    const result = Promise.resolve().then(() => run(controller.signal));
    const entry = { engineId, controller, result };
    this.test = entry;
    try {
      return await result;
    } finally {
      if (this.test === entry) this.test = null;
    }
  }

  /** Aborts the running test prompt; resolves once it has cleaned up, or now if none runs. */
  abortTest(): Promise<void> {
    if (!this.test) return Promise.resolve();
    this.test.controller.abort();
    return this.test.result.then(
      () => undefined,
      () => undefined,
    );
  }
}
