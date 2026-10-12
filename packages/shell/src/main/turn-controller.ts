import { randomUUID } from "node:crypto";
import { type Event, type HarnessRuntime, type LimitWindow, type RunningTurn, fail } from "@humanharness/runtime";
import type { ChatEntry, SendOptions } from "@humanharness/ui/client";
import { TurnRecorder } from "./chat-log";
import type { UsageMeta } from "./usage-log";

type Done = Extract<Event, { type: "done" }>;

export interface ChatLogLike {
  append(entry: ChatEntry): Promise<void>;
}

/** Thrown by `ensureRuntime` when the engine can't run turns: the turn ends with this error code. */
export class EngineUnavailable extends Error {
  constructor(readonly code: "engine-not-installed" | "outdated-version" | "session-expired" | "notice-required") {
    super(`The engine can't run: ${code}`);
  }
}

/** How the task manager runs a turn (the window's own sends only use `action`). */
export interface TurnOptions extends SendOptions {
  /** The task this turn belongs to: saved on its chat entries and in usage.jsonl. */
  task?: string;
  /** `close` for the turn that asks for the task's note. */
  phase?: "run" | "close";
  /** What the chat shows as the person's message when the engine gets something else (a task brief). */
  display?: string;
  /** A later turn of the same task: its chat entry isn't tagged with the action. */
  followUp?: boolean;
  /**
   * Nothing goes to the chat or the window (the closing turn); usage is still recorded. Plan limits still
   * reach the window, and a failure other than a cancel is logged and shown as an error-only entry.
   */
  quiet?: boolean;
  /** Sees every event of the turn, its `done` included. */
  onEvent?: (e: Event) => void;
}

export interface TurnDeps {
  /** Starts (or returns) the runtime. Null when the engine CLI isn't installed. May throw EngineUnavailable. */
  ensureRuntime: () => Promise<HarnessRuntime | null>;
  /** The chat log of the configured folder, or null when the app isn't configured yet. */
  chatLog: () => Promise<ChatLogLike | null>;
  stateBlocks: () => Set<string>;
  /** Sends an event to the window. May throw (window gone): that never loses the log entry. */
  emit: (e: Event) => void;
  /** Saves the finished turn's usage (usage.jsonl), with the turn's first limits snapshot. Failures are logged, never thrown. */
  recordUsage?: (entry: ChatEntry, meta: UsageMeta, firstLimits: LimitWindow[] | undefined) => Promise<void>;
  /**
   * A turn ended with `session-expired`: forget the engine's passed test prompt, so Settings → Engine
   * asks to sign in (or test) again instead of saying it is ready. Failures are logged, never thrown.
   */
  sessionExpired?: (engineId: string) => Promise<void>;
  /** The configured engine, read when the turn starts: the one `sessionExpired` is told about. */
  engineId?: () => Promise<string | undefined>;
}

/** One message's lifecycle: log, start the runtime, run the turn, log the reply and its usage, then tell the window. */
export class TurnController {
  private turn: { cancelled: boolean; running: RunningTurn | null } | null = null;
  private writes: Promise<void> = Promise.resolve();
  private active: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(private readonly deps: TurnDeps) {}

  /** A turn is starting or running. */
  isBusy(): boolean {
    return this.turn !== null;
  }

  cancel(): void {
    if (!this.turn) return;
    this.turn.cancelled = true;
    this.turn.running?.cancel();
  }

  /** For quitting: cancels the current turn and rejects every later send. */
  close(): void {
    this.closed = true;
    this.cancel();
  }

  /** Resolves once the current turn has ended and every queued chat-log write has settled. */
  async flush(): Promise<void> {
    await this.active.catch(() => undefined);
    let seen: Promise<void>;
    do {
      seen = this.writes;
      await seen;
    } while (seen !== this.writes);
  }

  /** Rejects when the app is closing, a turn is already running, or the app isn't set up. */
  send(message: string, options: TurnOptions = {}): Promise<void> {
    if (this.closed) return Promise.reject(new Error("The app is closing"));
    if (this.turn) return Promise.reject(new Error("A turn is already running"));
    this.active = this.run(message, options);
    return this.active;
  }

  private async run(message: string, options: TurnOptions): Promise<void> {
    const { action, task, phase, display, followUp, quiet, onEvent } = options;
    const turn: { cancelled: boolean; running: RunningTurn | null } = { cancelled: false, running: null };
    this.turn = turn;
    try {
      const log = await this.deps.chatLog();
      const engineId = await this.deps.engineId?.().catch(() => undefined);
      if (!log) throw new Error("The app is not set up yet");
      if (!quiet) {
        void this.write(log, {
          id: randomUUID(),
          role: "user",
          text: display ?? message,
          blocks: [],
          activities: [],
          at: new Date().toISOString(),
          ...(action && !followUp ? { action } : {}),
          ...(task ? { task } : {}),
        });
      }
      const recorder = new TurnRecorder(this.deps.stateBlocks());
      const meta: UsageMeta = { ...(action ? { action } : {}), ...(task ? { task } : {}), ...(phase ? { phase } : {}) };
      const finish = async (done: Done) => {
        const entry: ChatEntry = { ...recorder.finish(done), ...(task ? { task } : {}) };
        // A quiet turn that fails (e.g. the session expired) still shows its error, never its text.
        const surface = !quiet || (!done.ok && done.error.code !== "cancelled");
        if (surface) {
          await this.write(
            log,
            quiet ? { id: entry.id, role: "assistant", text: "", blocks: [], activities: [], at: entry.at, ...(done.ok ? {} : { error: done.error }), ...(task ? { task } : {}) } : entry,
          );
        }
        await this.recordUsage(entry, meta, recorder.firstLimits);
        if (!done.ok && done.error?.code === "session-expired" && engineId) await this.forgetSession(engineId);
        this.tell(onEvent, done);
        if (surface) this.emit(done);
      };

      if (turn.cancelled) return await finish(fail("cancelled") as Done);
      let rt: HarnessRuntime | null;
      try {
        rt = await this.deps.ensureRuntime();
      } catch (e) {
        if (e instanceof EngineUnavailable) return await finish(fail(e.code) as Done);
        return await finish(fail("agent-crashed", e instanceof Error ? e.message : String(e)) as Done);
      }
      if (turn.cancelled) return await finish(fail("cancelled") as Done);
      if (!rt) return await finish(fail("engine-not-installed") as Done);

      let finished: Promise<void> = Promise.resolve();
      turn.running = rt.send(message, (e) => {
        if (e.type === "done") finished = finish(e);
        else {
          recorder.add(e);
          this.tell(onEvent, e);
          // The context and compactions reach the window through the task view, never as chat events.
          if (e.type === "context" || e.type === "compaction") return;
          // Plan limits reach the usage meter even from a quiet turn.
          if (!quiet || e.type === "limits") this.emit(e);
        }
      });
      await turn.running.done;
      await finished;
    } finally {
      this.turn = null;
    }
  }

  /** Hands an event to the caller's listener; a throwing listener never breaks the turn. */
  private tell(onEvent: ((e: Event) => void) | undefined, e: Event): void {
    try {
      onEvent?.(e);
    } catch (err) {
      console.error("A turn listener failed", err);
    }
  }

  private emit(e: Event): void {
    try {
      this.deps.emit(e);
    } catch (err) {
      console.error("Could not send an event to the window", err);
    }
  }

  private async recordUsage(entry: ChatEntry, meta: UsageMeta, firstLimits: LimitWindow[] | undefined): Promise<void> {
    try {
      await this.deps.recordUsage?.(entry, meta, firstLimits);
    } catch (err) {
      console.error("Could not save usage", err);
    }
  }

  private async forgetSession(engineId: string): Promise<void> {
    try {
      await this.deps.sessionExpired?.(engineId);
    } catch (err) {
      console.error("Could not forget the expired session", err);
    }
  }

  /** Queues a log write: writes stay in order and a failure never rejects. */
  private write(log: ChatLogLike, entry: ChatEntry): Promise<void> {
    this.writes = this.writes.then(() =>
      log.append(entry).catch((err: unknown) => console.error("Could not save the chat", err)),
    );
    return this.writes;
  }
}

/**
 * Shares one in-flight call of `fn` and keeps its result. A failure or a null result
 * isn't kept, so the next call tries again (e.g. after installing the CLI).
 */
export function memoise<T>(fn: () => Promise<T | null>) {
  let promise: Promise<T | null> | null = null;
  return {
    get(): Promise<T | null> {
      if (!promise) {
        const p = fn().then(
          (v) => {
            if (v === null && promise === p) promise = null;
            return v;
          },
          (err: unknown) => {
            if (promise === p) promise = null;
            throw err;
          },
        );
        promise = p;
      }
      return promise;
    },
    /** The current or in-flight result, without starting anything. */
    peek(): Promise<T | null> | null {
      return promise;
    },
    clear(): void {
      promise = null;
    },
  };
}
