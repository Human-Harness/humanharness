import type { EngineDef, ModelProfile } from "@humanharness/engines";
import type { TaskRef, Tier } from "@humanharness/mod-sdk";
import type { CoreApp, CoreContextRecord, CoreDailyInput, CorePhase } from "@humanharness/mod-sdk/core";
import type { EngineAnswer, EngineSessionOptions } from "@humanharness/runtime";

/** A session as the app opens it (EngineSession, or a fake in tests). */
export interface CoreSessionLike {
  readonly profile: ModelProfile;
  ask(prompt: string, signal: AbortSignal): Promise<EngineAnswer>;
  close(): Promise<void>;
}

/**
 * The app's parts behind a core mod's `ctx.app` (app-lifecycle.ts builds them once).
 * Engine-typed; `coreAppFor` gives a mod the same by engine id.
 */
export interface CoreAppParts {
  /** `mods`: the manifest's raw mod configs; Sidekick reads `mods.sidekick`. */
  harness: { name: string; tagline?: string; mods?: Readonly<Record<string, unknown>> };
  phases(action: string | undefined): readonly CorePhase[];
  phaseBrief(action: string, phase: string): Promise<string | null>;
  dataTables(): string[];
  setup(): Promise<{ engineId: string; base: string } | null>;
  task(): Promise<(TaskRef & { phase?: string }) | null>;
  /** The open task's context record and the "Add now" turn (the task manager's own). */
  tasks: {
    contextRecord(taskId: string): Promise<CoreContextRecord | null>;
    addContext(taskId: string, path: string): { accepted: Promise<unknown>; done: Promise<void> };
  };
  hasNotice(engineId: string): Promise<boolean>;
  engine(engineId: string): EngineDef;
  command(engine: EngineDef): Promise<{ command: string[]; env: Record<string, string> } | null>;
  /** The `process`'s model in Settings › Models (light by default); with `tier`, that tier's. */
  profile(engine: EngineDef, tier: Tier | undefined, process: string): Promise<ModelProfile>;
  /** Session `id`'s working folder for core mod `mod` (`id` defaults to the mod's). */
  workDir(mod: string, base: string, id?: string): string;
  writeBrief(folder: string, text: string, engine: EngineDef): Promise<unknown>;
  open(o: EngineSessionOptions): CoreSessionLike;
  uiLanguage(): Promise<string>;
  dailyInput(base: string, day: string): Promise<CoreDailyInput>;
  pickImportFiles(): Promise<string[]>;
  /** The source-tag key of mod `id` (userData/<id>/source-key). */
  tagKey(id: string, create: boolean): Promise<Buffer | null>;
  /** A data request as the person. */
  personData(request: unknown, options: unknown): Promise<unknown>;
  /** The history go-backs: each asks with main's native dialog first and answers as `hh:restore`/`hh:restoreTask` do. */
  history: { restorePoint(sha: string): Promise<unknown>; restoreTask(id: string, includeShared?: boolean): Promise<unknown> };
  /** A note written as the person, with its history commit. */
  saveDecision(o: { scope: string; action?: string; title: string; decision: string }): Promise<void>;
}

/** Core mod `id`'s `ctx.app`: the app's parts, by engine id; its model is its own process's (`id`). */
export function coreAppFor(p: CoreAppParts, id: string): CoreApp {
  return {
    harness: {
      name: p.harness.name,
      ...(p.harness.tagline !== undefined ? { tagline: p.harness.tagline } : {}),
      ...(p.harness.mods?.sidekick !== undefined ? { sidekick: p.harness.mods.sidekick } : {}),
      phases: (action) => p.phases(action),
      phaseBrief: (action, phase) => p.phaseBrief(action, phase),
      dataTables: () => p.dataTables(),
    },
    setup: () => p.setup(),
    task: () => p.task(),
    tasks: {
      contextRecord: (taskId) => p.tasks.contextRecord(taskId),
      addContext: (taskId, file) => p.tasks.addContext(taskId, file),
      // The host replaces it with its own hook registration (mods/host.ts), so a restart drops the listeners.
      onContextChanged: () => () => {},
    },
    sessions: {
      hasNotice: (engineId) => p.hasNotice(engineId),
      command: (engineId) => p.command(p.engine(engineId)),
      profile: (engineId, tier) => p.profile(p.engine(engineId), tier, id),
      workDir: (base, sid) => p.workDir(id, base, sid),
      writeBrief: (folder, text, engineId) => p.writeBrief(folder, text, p.engine(engineId)),
      open: (o) =>
        p.open({ engine: p.engine(o.engineId), command: o.command, ...(o.env ? { env: o.env } : {}), folder: o.folder, profile: o.profile as unknown as ModelProfile }),
    },
    uiLanguage: () => p.uiLanguage(),
    dailyInput: (base, day) => p.dailyInput(base, day),
    pickImportFiles: () => p.pickImportFiles(),
    tagKey: (create) => p.tagKey(id, create),
    history: { restorePoint: (sha) => p.history.restorePoint(sha), restoreTask: (taskId, includeShared) => p.history.restoreTask(taskId, includeShared) },
    person: {
      data: (request, options) => p.personData(request, options ?? {}),
      note: (o) => p.saveDecision(o),
    },
  };
}
