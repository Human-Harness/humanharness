import { BACKEND_RESTARTS, type BackendInit, type BackendScope } from "@humanharness/harness-sdk";
import type { BackendProcess } from "./backend-process";

export type BackendState = "stopped" | "starting" | "running" | "failed";

/** What the supervisor needs of a process: BackendProcess, or a fake in tests. */
export type SupervisedProcess = Pick<BackendProcess, "call" | "notify" | "stop" | "exited">;

export interface BackendSupervisorDeps {
  startProcess: (init: BackendInit, onEvent: (event: string, data: unknown) => void) => Promise<SupervisedProcess>;
  onEvent: (event: string, data: unknown) => void;
  onState: (s: BackendState) => void;
  now?: () => number;
}

const NOT_RUNNING = "The backend isn't running";

/**
 * The harness backend's lifecycle (hatches spec §4.3, threat model B6). Restarts it after an unexpected exit (a
 * start that throws counts as one), at most BACKEND_RESTARTS.max times in any BACKEND_RESTARTS.windowMs, then
 * `failed` until the person's Restart. Every transition (start, crash restart, rebase, restart, stop) runs on one
 * promise chain, so they never interleave.
 */
export class BackendSupervisor {
  private current: BackendState = "stopped";
  private proc: SupervisedProcess | null = null;
  private init: BackendInit | null = null;
  /** False after stop(): an exit then is never a crash and nothing restarts. */
  private wanted = false;
  /** Transitions asked for and not done yet: calls are refused meanwhile (a rebase's old process is going away). */
  private transitions = 0;
  private crashes: number[] = [];
  private chain: Promise<void> = Promise.resolve();

  constructor(private readonly d: BackendSupervisorDeps) {}

  state(): BackendState {
    return this.current;
  }

  /** Starts it with `init` unless it's already up. After stop() (a folder move's start), starts it again. */
  start(init: BackendInit): Promise<void> {
    this.init = init;
    this.wanted = true;
    return this.enqueue(async () => {
      if (!this.wanted || this.proc) return;
      await this.launch();
    });
  }

  /** The person's Restart: clears the crash count and starts it again, from any state. */
  restart(): Promise<void> {
    this.wanted = true;
    return this.enqueue(async () => {
      if (!this.init || !this.wanted) return;
      this.crashes = [];
      await this.stopProcess();
      await this.launch();
    });
  }

  /** Folder moved or profile switched: stops it and starts it with the new `init`. */
  rebase(init: BackendInit): Promise<void> {
    this.init = init;
    this.wanted = true;
    return this.enqueue(async () => {
      if (!this.wanted) return;
      await this.stopProcess();
      await this.launch();
    });
  }

  /** Remembers the scopes for the next start, and tells a running backend now. */
  scopesChanged(scopes: BackendScope[]): void {
    if (!this.init) return;
    this.init = { ...this.init, scopes };
    if (this.current === "running" && this.proc && this.transitions === 0) this.proc.notify("scopesChanged", this.init);
  }

  call(method: string, params: unknown): Promise<unknown> {
    if (this.current !== "running" || !this.proc || this.transitions > 0) return Promise.reject(new Error(NOT_RUNNING));
    return this.proc.call(method, params);
  }

  /** For quit and a folder move's start: stops it; nothing restarts until start() or rebase(). */
  stop(): Promise<void> {
    this.wanted = false;
    return this.enqueue(async () => {
      await this.stopProcess();
      this.setState("stopped");
    });
  }

  private enqueue(step: () => Promise<void>): Promise<void> {
    this.transitions++;
    const run = this.chain.then(step).finally(() => {
      this.transitions--;
    });
    this.chain = run.catch(() => {});
    return run;
  }

  private setState(s: BackendState): void {
    if (s === this.current) return;
    this.current = s;
    this.d.onState(s);
  }

  /** Runs inside a transition. A start that throws is a crash. */
  private async launch(): Promise<void> {
    const init = this.init;
    if (!init) return;
    this.setState("starting");
    let proc: SupervisedProcess;
    try {
      proc = await this.d.startProcess(init, (event, data) => this.d.onEvent(event, data));
    } catch {
      await this.crashed();
      return;
    }
    this.proc = proc;
    this.setState("running");
    void proc.exited.then((exit) => {
      // A process stopped or replaced on purpose is no longer `this.proc`.
      if (this.proc !== proc) return;
      this.proc = null;
      if (exit.expected || !this.wanted) return;
      void this.enqueue(() => this.crashed()).catch(() => {});
    });
  }

  /** Runs inside a transition: restarts within the limit, or `failed`. */
  private async crashed(): Promise<void> {
    // Stopped meanwhile, or a rebase/restart queued before this already started a fresh one.
    if (!this.wanted || this.proc) return;
    const now = (this.d.now ?? Date.now)();
    this.crashes = this.crashes.filter((t) => now - t < BACKEND_RESTARTS.windowMs);
    this.crashes.push(now);
    if (this.crashes.length > BACKEND_RESTARTS.max) {
      this.setState("failed");
      return;
    }
    await this.launch();
  }

  private async stopProcess(): Promise<void> {
    const proc = this.proc;
    this.proc = null;
    await proc?.stop();
  }
}
