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

/** What the agent hooks are told about the harness the agent works in. */
export interface AgentInfo {
  /** The agent may edit the work folder. */
  canEdit: boolean;
}
/** A tool the mod adds to the agent's `ui` server, beside the harness's blocks. */
export interface AgentTool {
  /** What the agent calls: letters, digits, `_` and `-`; never a block's, the app's or an earlier mod's tool name. */
  name: string;
  description: string;
  /** The arguments' JSON Schema, of `type: "object"`, in the subset a plugin's schemas take. Undeclared keys are dropped. */
  inputSchema: Record<string, unknown>;
  /** Only in a task's session: a background job can't ask the person. */
  tasksOnly?: boolean;
  /** What the agent reads when the app does not answer in time. */
  timeoutError?: string;
  /** Answers a call: the agent reads the result as JSON; a thrown error's message reaches it as it is. */
  handle(args: Record<string, unknown>): unknown;
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
    /**
     * Lines added to the agent's instructions (AGENTS.md) as one section after the app's own, in mod order; [] adds
     * none. Asked each time the instructions are written. The app always gives it, and `agentTools`; a ctx made only
     * to check or test a mod may not.
     */
    instructions?(fn: (o: AgentInfo) => string[] | Promise<string[]>): Disposer;
    /** Tools added to the agent's `ui` server; asked each time an agent session is opened. */
    agentTools?(fn: (o: AgentInfo) => AgentTool[] | Promise<AgentTool[]>): Disposer;
  };
  /**
   * A channel the mod's own ui calls (0b wires the ui side). A core mod may also name an app channel (`hh:…`): the
   * window's calls on that channel reach the handler, with their arguments as an array.
   */
  ipc(name: string, handler: (payload: unknown) => unknown): Disposer;
  /**
   * Sends `value` to the mod's own ui, on `name` (its `ctx.on(name, fn)` hears it), while the mod is on. A name of the
   * mod's own: an app channel's name (`hh:…`) throws.
   */
  push(name: string, value: unknown): void;
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

/** What a mod's `ui` part gets: its blocks, and its own main's names. */
export interface UiCtx {
  readonly id: string;
  block(name: string, component: unknown): Disposer;
  /**
   * Calls `name` on the mod's own main (its `ctx.ipc(name, …)`) with `payload`, and resolves with the answer. Rejects
   * when the mod is off, its main has no such name, or the handler throws. Only the mod's own names: never another
   * mod's. The window's loader always gives it; a ctx made only to collect blocks (a check, a test) may not.
   */
  call?(name: string, payload?: unknown): Promise<unknown>;
  /** Hears the mod's own main's `ctx.push(name, value)`; returns the way to stop. Stops by itself when the mod goes off. */
  on?(name: string, fn: (value: unknown) => void): Disposer;
  /**
   * A tab in Settings, right after Models; its id is `name` (search opens it), its button says `label`. The component
   * gets `{ openTab(id), client, state }`, the app's client and state. `o.shown(state)` says when the tab shows
   * (default: always); `o.useLabel({ client, state })`, a hook called while Settings is open, gives a name that changes
   * (default `label`). Like every slot below, it renders behind the block boundary: a part that throws shows
   * "This part of the app failed" with Turn off.
   */
  settingsTab?(name: string, component: unknown, o: { label: string; shown?(state: unknown): boolean; useLabel?(app: { client: unknown; state: unknown }): string }): Disposer;
  /**
   * A row after the core's: in Settings › Models' task rows (the component gets `{ taskRow({ key, label, description }) }`,
   * which draws a level picker the core's way for `models.tasks[key]`), or Settings › Usage's lines apart from the tasks
   * (it gets `{ usage }`, the usage summary or null). Both get `{ client, state }`; `o.shown(props)`, given the same
   * props, says when the row shows (default: always).
   */
  row?(place: RowPlace, component: unknown, o?: { shown?(props: { client: unknown; state: unknown; usage?: unknown }): boolean }): Disposer;
  /** A piece in the task bar, after the core's; the component gets `{ task }`, the open task's id or null. */
  taskBar?(component: unknown): Disposer;
  /**
   * A right overlay of the open task: `button` goes in the task bar (it gets `{ expanded, controls, onOpen, buttonRef }`),
   * `panel` in the overlay (it gets `{ close }`). One overlay open at a time, folded on a task switch; none in a narrow
   * window or in slim mode.
   */
  taskOverlay?(o: { name: string; button: unknown; panel: unknown }): Disposer;
  /** Reviews the composer's sends (Enter reviews first, ⌥⏎ forces a review, ⌘⏎ sends at once) and the answer form's. */
  composer?(reviewer: ComposerReviewer): Disposer;
  /**
   * A page of the task view, once per mod: `rail` is its entry in the task group of the rail, `title` the page's
   * title (a key of the app's strings, or plain text), `name` which page it is (only "history" is hosted today), and
   * `page` the component, which gets the props the core's History panel gets, with `client` and `onBack`.
   */
  taskPage?(o: { name: string; rail: { icon: string; label: string }; title: string; page: unknown }): Disposer;
}

/** Where a mod's `row` goes. */
type RowPlace = "models" | "usage";
/** What a review of a send says: send it as it is, or hold it (the mod shows why; the draft stays). */
type ReviewVerdict = "send" | "hold";
interface ComposerReviewer {
  /** Spans of the draft to underline, `[start, end)`. */
  marks?(draft: string): readonly (readonly [number, number])[];
  /** `signal` aborts when the person sends at once or the form goes; `answer`: the text is an answer form's free text. */
  review(text: string, signal: AbortSignal, o: { force: boolean; answer: boolean }): Promise<ReviewVerdict>;
  /** The longest wait the countdown shows, in seconds, or "always" (default 6). */
  wait?: number | "always";
}

export interface ModDefinition<C = undefined> {
  id: string;
  schema?: ZodType<C>;
  main?(ctx: MainCtx<C>): void | Promise<void>;
  ui?(ctx: UiCtx): void;
}
