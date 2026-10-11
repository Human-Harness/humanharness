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
  /** The install, update, login or logout running now, if any (one at a time). */
  setupStep: SetupStep | null = null;
  private test: AbortController | null = null;

  /** Why a turn can't start now, or null when it can. */
  turnBlocked(): string | null {
    if (this.switching) return "The engine is being changed";
    if (this.setupStep === "logout" || this.setupStep === "update") return "The engine is being updated or signed out";
    return null;
  }

  /**
   * Changes the engine: turns are refused from the first moment; the config is saved, then the old
   * runtime is closed and the old engine's chat archived. Returns the engine whose chat was archived.
   */
  async switchEngine(d: SwitchDeps): Promise<string | null> {
    if (this.switching) throw new Error("The engine is already being changed");
    if (d.isBusy()) throw new Error("A turn is running");
    this.switching = true;
    try {
      await d.save();
      // Sends are refused while switching, so this only waits for a turn that slipped in before.
      if (d.isBusy()) await d.idle();
      await d.dropRuntime();
      const from = await d.archiveChat();
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

  /** Reserves the setup slot. Logout and update also need no turn running (they pull the CLI from under it). */
  beginSetup(step: SetupStep, isBusy: () => boolean): void {
    if (this.setupStep) throw new Error("A setup step is already running");
    if (this.switching) throw new Error("The engine is being changed");
    if ((step === "logout" || step === "update") && isBusy()) throw new Error("A turn is running");
    this.setupStep = step;
  }

  endSetup(): void {
    this.setupStep = null;
  }

  /** Reserves the test-prompt slot; the signal aborts it (e.g. on quit). */
  beginTest(): AbortSignal {
    if (this.test) throw new Error("A test is already running");
    this.test = new AbortController();
    return this.test.signal;
  }

  endTest(): void {
    this.test = null;
  }

  abortTest(): void {
    this.test?.abort();
  }
}
