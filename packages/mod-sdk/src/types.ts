import type { ZodType } from "zod";

/** Every registration returns one; the host runs it before reloading or turning the mod off (spec §4.2). */
export type Disposer = () => void;
export type Tier = "light" | "standard" | "deep";

export interface TaskRef {
  id: string;
  action?: string;
  scope: string;
  phase?: string;
}
/** A send about to happen: a new task (`action` set) or a follow-up/question in the open one. */
export interface SendInfo {
  text: string;
  action?: string;
  scope?: string;
  /** The task that receives it, if one is open. */
  task: TaskRef | null;
}
/** What a held send ends with (`ctx.holds.resolve`): send it as it is, send another text, or don't send it. */
export type HoldVerdict = { kind: "pass" } | { kind: "rewrite"; text: string } | { kind: "cancel" };
/**
 * Pass, or replace the text, within BEFORE_SEND_MS in total. `hold` keeps the send until the mod resolves `token`
 * (`ctx.holds.resolve`): the wait is the person's, so it counts toward no limit. Closing the task, quitting or turning
 * the mod off cancels a held send.
 */
export type SendVerdict = { kind: "pass" } | { kind: "rewrite"; text: string } | { kind: "hold"; token: string };
export interface TurnEndInfo {
  task: TaskRef;
  ok: boolean;
  prompt: string;
  reply: string;
  fromBlock: boolean;
  modeSwitch: boolean;
  context?: { used: number; cap?: number };
}
/** A task's phase moved (by the person, the agent or the app): the phase left and the phase entered. */
export interface PhaseMovedInfo {
  task: TaskRef;
  from: string;
  to: string;
}
/** A local calendar day, YYYY-MM-DD. */
export interface DailyInfo {
  day: string;
}
/**
 * A collection of the mod's own in the work folder (`.harness/data/`), one per base: what changes it is in the
 * history (one `Data: <name>` commit per write) and undo restores it like any data.
 */
export interface ModStore {
  readonly name: string;
  /** Every record, app-wide; [] before setup. */
  readAll(): Promise<Record<string, unknown>[]>;
  /** Data requests on this collection, run as the app, then one history commit. All are checked before any runs; throws when refused. */
  write(requests: readonly unknown[]): Promise<void>;
}
/** Tokens a turn used, as the engine reported them. */
export interface ModTokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}
/** One turn the mod ran itself, for the usage log. */
export interface UsageEntry {
  engine: string;
  ok: boolean;
  task?: string;
  scope?: string;
  action?: string;
  /** Who spoke, when the mod has more than one voice. */
  by?: string;
  tier?: Tier | "custom";
  model?: string;
  effort?: string;
  usage?: ModTokens;
  limits?: unknown[];
}
/** The mod's own tokens (input, output and cache writes for `task`; all four for `week` and `day`). */
export interface UsageSummary {
  week: number;
  task?: number;
  /** The day's tokens: the tasks' turns and the mod's. */
  day?: { tasks: number; mod: number };
}
export interface EngineRunResult {
  ok: boolean;
  text: string;
  error?: string;
}

export interface MainCtx<C = undefined> {
  readonly id: string;
  /** The harness's `mods.<id>`, parsed by the mod's schema; undefined without a schema. */
  readonly config: C;
  readonly on: {
    beforeSend(fn: (send: SendInfo) => Promise<SendVerdict> | SendVerdict): Disposer;
    turnStart(fn: (task: TaskRef) => void | Promise<void>): Disposer;
    turnEnd(fn: (end: TurnEndInfo) => void | Promise<void>): Disposer;
    taskOpen(fn: (task: TaskRef) => void | Promise<void>): Disposer;
    taskClose(fn: (task: TaskRef) => void | Promise<void>): Disposer;
    /** No task runs: between one task and the next. Awaited before the next task starts (within the hook limit). */
    betweenTasks(fn: () => void | Promise<void>): Disposer;
    phaseMoved(fn: (e: PhaseMovedInfo) => void | Promise<void>): Disposer;
    /** At start and at each local midnight while the app runs; the mod tells a day it already did by `day`. */
    daily(fn: (d: DailyInfo) => void | Promise<void>): Disposer;
    /** The app is quitting; before the disposers run. */
    close(fn: () => void | Promise<void>): Disposer;
  };
  /**
   * A channel the mod's own ui calls (0b wires the ui side). A core mod may also name an app channel (`hh:…`): the
   * window's calls on that channel reach the handler, with their arguments as an array.
   */
  ipc(name: string, handler: (payload: unknown) => unknown): Disposer;
  /** Ends a send this mod held (`{ kind: "hold", token }`); false when there is no such held send (cancelled, or resolved). */
  readonly holds: { resolve(token: string, verdict: HoldVerdict): boolean };
  /** The mod's own collections, per base: `name` is the mod's id or starts with `<id>-`; `collection` as a harness declares one. */
  readonly stores: { open(name: string, collection: unknown): ModStore };
  /** The mod's own turns in the usage log, and what it spent. */
  readonly usage: { record(kind: string, entry: UsageEntry): Promise<void>; summary(o?: { task?: string; day?: string }): Promise<UsageSummary> };
  /** The mod holds a task in focus (it waits on the person there); the app asks `focused(taskId)`. Cleared when the mod goes off. */
  readonly focus: { set(taskId: string, on: boolean): void };
  /** A session of the mod's own, on a tier, outside the work folder, without tools; usage is tagged with the mod's id. */
  readonly engine: { run(tier: Tier, prompt: string, opts?: { signal?: AbortSignal }): Promise<EngineRunResult> };
  readonly tasks: { running(): Promise<TaskRef | null> };
  readonly notes: { titles(scope?: string): Promise<string[]> };
  /** App-private JSON state, outside the work folder. */
  readonly storage: { get<T = unknown>(key: string): Promise<T | undefined>; set(key: string, value: unknown): Promise<void> };
  /** `.harness/mods/<id>/` in the work folder, created on first call; null before setup. */
  dataDir(): Promise<string | null>;
  notify(text: string): void;
  provide(service: unknown): void;
  readonly mods: { get<T = unknown>(id: string): T | undefined };
  log(...args: unknown[]): void;
}

/** 0b renders what a mod registers here; 0a only types it. */
export interface UiCtx {
  readonly id: string;
  block(name: string, component: unknown): Disposer;
}

export interface ModDefinition<C = undefined> {
  id: string;
  schema?: ZodType<C>;
  main?(ctx: MainCtx<C>): void | Promise<void>;
  ui?(ctx: UiCtx): void;
}
