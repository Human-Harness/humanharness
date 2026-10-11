import { randomUUID } from "node:crypto";
import { type Event, type HarnessRuntime, type RunningTurn, fail } from "@humanharness/runtime";
import type { ChatEntry } from "@humanharness/ui/client";
import { TurnRecorder } from "./chat-log";

type Done = Extract<Event, { type: "done" }>;

export interface ChatLogLike {
  append(entry: ChatEntry): Promise<void>;
}

export interface TurnDeps {
  /** Starts (or returns) the runtime. Null when the engine CLI isn't installed. */
  ensureRuntime: () => Promise<HarnessRuntime | null>;
  /** The chat log of the configured folder, or null when the app isn't configured yet. */
  chatLog: () => Promise<ChatLogLike | null>;
  stateBlocks: () => Set<string>;
  /** Sends an event to the window. May throw (window gone): that never loses the log entry. */
  emit: (e: Event) => void;
}

/** One message's lifecycle: log, start the runtime, run the turn, log the reply, then tell the window. */
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
  send(message: string): Promise<void> {
    if (this.closed) return Promise.reject(new Error("The app is closing"));
    if (this.turn) return Promise.reject(new Error("A turn is already running"));
    this.active = this.run(message);
    return this.active;
  }

  private async run(message: string): Promise<void> {
    const turn: { cancelled: boolean; running: RunningTurn | null } = { cancelled: false, running: null };
    this.turn = turn;
    try {
      const log = await this.deps.chatLog();
      if (!log) throw new Error("The app is not set up yet");
      void this.write(log, { id: randomUUID(), role: "user", text: message, blocks: [], activities: [], at: new Date().toISOString() });
      const recorder = new TurnRecorder(this.deps.stateBlocks());
      const finish = async (done: Done) => {
        await this.write(log, recorder.finish(done));
        this.emit(done);
      };

      if (turn.cancelled) return await finish(fail("cancelled") as Done);
      let rt: HarnessRuntime | null;
      try {
        rt = await this.deps.ensureRuntime();
      } catch (e) {
        return await finish(fail("agent-crashed", e instanceof Error ? e.message : String(e)) as Done);
      }
      if (turn.cancelled) return await finish(fail("cancelled") as Done);
      if (!rt) return await finish(fail("engine-not-installed") as Done);

      let finished: Promise<void> = Promise.resolve();
      turn.running = rt.send(message, (e) => {
        if (e.type === "done") finished = finish(e);
        else {
          recorder.add(e);
          this.emit(e);
        }
      });
      await turn.running.done;
      await finished;
    } finally {
      this.turn = null;
    }
  }

  private emit(e: Event): void {
    try {
      this.deps.emit(e);
    } catch (err) {
      console.error("Could not send an event to the window", err);
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
