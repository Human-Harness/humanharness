import { randomUUID } from "node:crypto";
import type { ModelProfile } from "@humanharness/engines";
import { blockIdOf } from "@humanharness/harness-sdk";
import { type Event, type HarnessRuntime, type LimitWindow, type RunningTurn, fail } from "@humanharness/runtime";
import type { ChatEntry, SendOptions } from "@humanharness/ui/client";
import { TurnRecorder } from "./chat-log";
import { type UsageMeta, profileMeta } from "./usage-log";

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
  /** The task's scope (`_app` included), for usage.jsonl and the history trailer. Harnesses with scopes only. */
  scope?: string;
  /** Which scope's chat the turn writes (the open scope's). Absent: `main`, the only chat without scopes. */
  chat?: string;
  /** `close` for the turn that asks for the task's note; `checkpoint` for the quiet mid-task note. */
  phase?: "run" | "close" | "checkpoint";
  /**
   * The task's finished-turn count when this turn starts. With `task`, in a run turn, each block the person answers
   * gets the id `<task>:<turn>:<index>` (input-blocks spec §4). Absent: no ids (spec D0).
   */
  turn?: number;
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
  /** The task's model profile: every turn of the task runs on it (resources spec §5). */
  profile?: ModelProfile;
  /**
   * A first turn the task manager will retry on another model: a `model-unavailable` end is neither logged
   * nor shown (only `onEvent` sees it; its usage is recorded). Its events reach the window only from its
   * first content on (text, activity, block), so a held attempt shows nothing. Any other end is handled as usual.
   */
  holdModelError?: boolean;
  /**
   * A quiet turn another turn follows right away (the checkpoint): any failure is neither logged nor shown,
   * so the window keeps waiting for the next turn's own end. Usage is recorded; only `onEvent` sees it.
   */
  holdFailure?: boolean;
  /** The retry of a held turn: the person's message is already in the chat. */
  skipUserEntry?: boolean;
  /** The task's mode while this turn runs: usage.jsonl records it (task-modes spec §5.5). */
  mode?: string;
  /** The person picked `mode`: the chat's user entry is a system line naming it, never their message (spec §5.4). */
  modeSwitch?: boolean;
}

export interface TurnDeps {
  /** Starts (or returns) the runtime. Null when the engine CLI isn't installed. May throw EngineUnavailable. */
  ensureRuntime: () => Promise<HarnessRuntime | null>;
  /** The chat log of the configured folder (`chat`: the scope whose chat it is; absent: `main`), or null when the app isn't configured yet. */
  chatLog: (chat?: string) => Promise<ChatLogLike | null>;
  stateBlocks: () => Set<string>;
  /** The names of the blocks the person answers. Absent: none (spec D0). */
  inputBlocks?: () => Set<string>;
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

/** The turn's end stays out of the chat and the window (`holdModelError`, `holdFailure`). */
export function isHeld(done: Done, options: Pick<TurnOptions, "holdModelError" | "holdFailure">): boolean {
  if (done.ok) return false;
  return (options.holdModelError === true && done.error.code === "model-unavailable") || options.holdFailure === true;
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
    const { action, task, scope, chat, phase, turn, display, followUp, quiet, onEvent, profile, holdModelError, holdFailure, skipUserEntry, mode, modeSwitch } = options;
    const current: { cancelled: boolean; running: RunningTurn | null } = { cancelled: false, running: null };
    this.turn = current;
    try {
      const log = await this.deps.chatLog(chat);
      const engineId = await this.deps.engineId?.().catch(() => undefined);
      if (!log) throw new Error("The app is not set up yet");
      if (!quiet && !skipUserEntry) {
        void this.write(log, {
          id: randomUUID(),
          role: "user",
          text: display ?? message,
          blocks: [],
          activities: [],
          at: new Date().toISOString(),
          ...(action && !followUp ? { action } : {}),
          ...(task ? { task } : {}),
          // `modeSwitch` needs both `mode` and `display` ("Switched to …"): without `display` the mode's prompt lands here.
          ...(modeSwitch && mode ? { mode } : {}),
        });
      }
      const recorder = new TurnRecorder(this.deps.stateBlocks());
      // Every block event counts toward the index; only input blocks of a task's run turn get an id.
      const inputs = turn !== undefined && task && (phase ?? "run") === "run" ? this.deps.inputBlocks?.() : undefined;
      let blockIndex = 0;
      const stamp = (e: Event): Event => {
        if (e.type !== "block") return e;
        const index = blockIndex++;
        return inputs?.has(e.name) && task && turn !== undefined ? { ...e, id: blockIdOf(task, turn, index) } : e;
      };
      let reportedModel: string | undefined;
      const meta = (): UsageMeta => ({
        ...(action ? { action } : {}),
        ...(task ? { task } : {}),
        ...(scope ? { scope } : {}),
        ...(mode ? { mode } : {}),
        ...(phase ? { phase } : {}),
        ...(profile ? profileMeta(profile) : {}),
        ...(reportedModel ? { reportedModel } : {}),
      });
      // A held attempt keeps its events until its model answers: one that fails shows nothing.
      let pending: Event[] | null = holdModelError ? [] : null;
      const release = () => {
        const events = pending ?? [];
        pending = null;
        for (const e of events) this.emit(e);
      };
      const finish = async (done: Done) => {
        const entry: ChatEntry = { ...recorder.finish(done), ...(task ? { task } : {}) };
        if (isHeld(done, options)) {
          // The attempt is discarded, but plan limits are about the plan: the usage meter still updates.
          const limits = (pending ?? []).filter((e) => e.type === "limits");
          pending = null;
          for (const e of limits) this.emit(e);
          await this.recordUsage(entry, meta(), recorder.firstLimits);
          if (!done.ok && done.error.code === "session-expired" && engineId) await this.forgetSession(engineId);
          this.tell(onEvent, done);
          return;
        }
        release();
        // A quiet turn that fails (e.g. the session expired) still shows its error, never its text.
        const surface = !quiet || (!done.ok && done.error.code !== "cancelled");
        if (surface) {
          await this.write(
            log,
            quiet ? { id: entry.id, role: "assistant", text: "", blocks: [], activities: [], at: entry.at, ...(done.ok ? {} : { error: done.error }), ...(task ? { task } : {}) } : entry,
          );
        }
        await this.recordUsage(entry, meta(), recorder.firstLimits);
        if (!done.ok && done.error?.code === "session-expired" && engineId) await this.forgetSession(engineId);
        this.tell(onEvent, done);
        if (surface) this.emit(done);
      };

      if (current.cancelled) return await finish(fail("cancelled") as Done);
      let rt: HarnessRuntime | null;
      try {
        rt = await this.deps.ensureRuntime();
      } catch (e) {
        if (e instanceof EngineUnavailable) return await finish(fail(e.code) as Done);
        return await finish(fail("agent-crashed", e instanceof Error ? e.message : String(e)) as Done);
      }
      if (current.cancelled) return await finish(fail("cancelled") as Done);
      if (!rt) return await finish(fail("engine-not-installed") as Done);

      let finished: Promise<void> = Promise.resolve();
      current.running = rt.send(message, (raw) => {
        const e = stamp(raw);
        if (e.type === "done") finished = finish(e);
        else {
          if (e.type === "usage" && e.model) reportedModel = e.model;
          recorder.add(e);
          this.tell(onEvent, e);
          // The context and compactions reach the window through the task view, never as chat events.
          if (e.type === "context" || e.type === "compaction") return;
          // Plan limits reach the usage meter even from a quiet turn.
          if (quiet && e.type !== "limits") return;
          // A held attempt buffers only usage and limits: it assumes engines report model-unavailable before
          // any content (text, activity, block), so the first content releases the buffer for good.
          if (pending && (e.type === "limits" || e.type === "usage")) pending.push(e);
          else {
            release();
            this.emit(e);
          }
        }
      }, { ...(profile ? { profile } : {}), ...(task ? { trailer: { task, ...(action ? { action } : {}), ...(scope ? { scope } : {}) } } : {}) });
      await current.running.done;
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
