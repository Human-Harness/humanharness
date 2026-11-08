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
/** Pass, or replace the text. Holding is just answering late: the host waits at most BEFORE_SEND_MS in total. */
export type SendVerdict = { kind: "pass" } | { kind: "rewrite"; text: string };
export interface TurnEndInfo {
  task: TaskRef;
  ok: boolean;
  prompt: string;
  reply: string;
  fromBlock: boolean;
  modeSwitch: boolean;
  context?: { used: number; cap?: number };
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
  };
  /** A channel the mod's own ui calls (0b wires the ui side). */
  ipc(name: string, handler: (payload: unknown) => unknown): Disposer;
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
