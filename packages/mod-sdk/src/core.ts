// The core-only part of the mod API (minimal-core 1a): what a mod the app ships (`packages/mods/*`) gets beyond `MainCtx`.
// Not exported from the package's index, so hh.d.ts and the released contract never show it: a harness's or a local
// mod's ctx has no `app`, and its `push` reaches only its own ui (never an app channel).
import type { Disposer, MainCtx, ModTokens, TaskRef, Tier } from "./types";

/** A model as Settings › Models resolves it: passed back to `sessions.open` as it is. */
export interface CoreModelProfile {
  readonly engine: string;
  readonly tier: string;
  readonly model?: string;
  readonly effort: string;
  readonly cap: number;
}

/** One turn's answer in a core session; never thrown: a crash, an abort or an engine error is `ok: false`. */
export interface CoreAnswer {
  ok: boolean;
  text: string;
  usage?: ModTokens & { costUsd?: number };
  limits?: unknown[];
  model?: string;
  error?: { code: string; detail?: string };
}

/** A tool-less session that lasts several turns (one at a time), in its own folder, on the engine and model the mod chose. */
export interface CoreEngineSession {
  readonly profile: CoreModelProfile;
  ask(prompt: string, signal: AbortSignal): Promise<CoreAnswer>;
  /** Waits for a running turn: abort its signal first to end it at once. */
  close(): Promise<void>;
}

export interface CorePhase {
  id: string;
  label: string;
  brief?: string;
}

/** What a daily summary reads about a local day (YYYY-MM-DD) in a base. */
export interface CoreDailyInput {
  day: string;
  notes: string[];
  tokens: { tasks: number; sidekick: number; jobs?: number };
  open: string[];
}

/** The app's own services a core mod needs (Sidekick's main, moved out of the core). */
export interface CoreApp {
  readonly harness: {
    readonly name: string;
    readonly tagline?: string;
    /** The harness's raw `sidekick` key, as Sidekick's config; undefined when it declares none. */
    readonly sidekick?: unknown;
    /** The phases of `action`, in order ([] without). */
    phases(action: string | undefined): readonly CorePhase[];
    /** The text of a phase's brief; null when it has none or can't be read. */
    phaseBrief(action: string, phase: string): Promise<string | null>;
    /** The data tables the task agent sees. */
    dataTables(): string[];
  };
  /** The set-up app's engine and base; null when it isn't set up. */
  setup(): Promise<{ engineId: string; base: string } | null>;
  /** The open task with its open phase, when it has one. */
  task(): Promise<TaskRef | null>;
  readonly sessions: {
    /** Whether the person accepted the engine's notice. */
    hasNotice(engineId: string): Promise<boolean>;
    /** The engine's CLI; null when it can't be found. */
    command(engineId: string): Promise<{ command: string[]; env: Record<string, string> } | null>;
    /** The mod's own model (its process in Settings › Models, light by default); with `tier`, that tier's model. */
    profile(engineId: string, tier?: Tier): Promise<CoreModelProfile>;
    /** A session's working folder for `base`, outside it (the base's CLAUDE.md/AGENTS.md never load there). */
    workDir(base: string, id?: string): string;
    /** Writes the session's brief (AGENTS.md and the engine's own file) when it changed. */
    writeBrief(folder: string, text: string, engineId: string): Promise<unknown>;
    open(o: { engineId: string; command: string[]; env?: Record<string, string>; folder: string; profile: CoreModelProfile }): CoreEngineSession;
  };
  /** The app's UI language, by name. */
  uiLanguage(): Promise<string>;
  dailyInput(base: string, day: string): Promise<CoreDailyInput>;
  /** The system's file picker (text files): paths only, [] when cancelled; nothing is read. */
  pickImportFiles(): Promise<string[]>;
  /** The key that tags a files source (32 random bytes in userData, never in a base); made only when `create`. */
  tagKey(create: boolean): Promise<Uint8Array | null>;
  /** Writes as the person: their checks, turns-blocked refusals and history commits, as the window's own. */
  readonly person: {
    /** A data request, as the window's (`options.scope`, else the chat's scope). */
    data(request: unknown, options?: { scope?: string }): Promise<unknown>;
    /** A note in `scope`, never over another one, with its history commit. */
    note(o: { scope: string; action?: string; title: string; decision: string }): Promise<void>;
  };
}

/** A core mod's ctx: `MainCtx`, with a push to the window on an existing app channel (`hh:…`) and the app's services. */
export type CoreMainCtx<C = undefined> = MainCtx<C> & {
  /**
   * With an app channel's name (`hh:…`): sends `value` to the window on that app push channel, and throws for any the
   * app doesn't push (or `hh:modPush`). Any other name is the mod's own, as `MainCtx.push`.
   */
  push(channel: `hh:${string}`, value: unknown): void;
  readonly app: CoreApp;
  /**
   * Runs `fn` when the base or its data changed under the mod without a task opening or closing: a profile switch or
   * an undo. The mod reads its settings and the base again and sends its state.
   */
  onRefresh?(fn: () => void | Promise<void>): Disposer;
};
