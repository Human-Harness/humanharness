import type { EngineDef, ModelProfile } from "@humanharness/engines";
import type { TaskRef, Tier } from "@humanharness/mod-sdk";
import type { CoreApp, CoreDailyInput, CorePhase } from "@humanharness/mod-sdk/core";
import type { SidekickAnswer, SidekickSessionOptions } from "@humanharness/runtime";

/** A session as the app opens it (SidekickSession, or a fake in tests). */
export interface CoreSessionLike {
  readonly profile: ModelProfile;
  ask(prompt: string, signal: AbortSignal): Promise<SidekickAnswer>;
  close(): Promise<void>;
}

/**
 * The app's parts behind `ctx.app` (app-lifecycle.ts builds them once, and Sidekick's controller uses the same ones).
 * Engine-typed like the controller's deps; `coreAppFor` gives a mod the same by engine id.
 */
export interface CoreAppParts {
  harness: { name: string; tagline?: string; sidekick?: unknown };
  phases(action: string | undefined): readonly CorePhase[];
  phaseBrief(action: string, phase: string): Promise<string | null>;
  dataTables(): string[];
  setup(): Promise<{ engineId: string; base: string } | null>;
  task(): Promise<(TaskRef & { phase?: string }) | null>;
  hasNotice(engineId: string): Promise<boolean>;
  engine(engineId: string): EngineDef;
  command(engine: EngineDef): Promise<{ command: string[]; env: Record<string, string> } | null>;
  /** The `process`'s model in Settings › Models (light by default); with `tier`, that tier's. */
  profile(engine: EngineDef, tier: Tier | undefined, process: string): Promise<ModelProfile>;
  workDir(base: string, id?: string): string;
  writeBrief(folder: string, text: string, engine: EngineDef): Promise<unknown>;
  open(o: SidekickSessionOptions): CoreSessionLike;
  uiLanguage(): Promise<string>;
  dailyInput(base: string, day: string): Promise<CoreDailyInput>;
  pickImportFiles(): Promise<string[]>;
  /** The source-tag key of mod `id` (userData/<id>/source-key). */
  tagKey(id: string, create: boolean): Promise<Buffer | null>;
  /** A data request as the person. */
  personData(request: unknown, options: unknown): Promise<unknown>;
  /** A note written as the person, with its history commit. */
  saveDecision(o: { scope: string; action?: string; title: string; decision: string }): Promise<void>;
}

/** Core mod `id`'s `ctx.app`: the app's parts, by engine id; its model is its own process's (`id`). */
export function coreAppFor(p: CoreAppParts, id: string): CoreApp {
  return {
    harness: {
      name: p.harness.name,
      ...(p.harness.tagline !== undefined ? { tagline: p.harness.tagline } : {}),
      ...(p.harness.sidekick !== undefined ? { sidekick: p.harness.sidekick } : {}),
      phases: (action) => p.phases(action),
      phaseBrief: (action, phase) => p.phaseBrief(action, phase),
      dataTables: () => p.dataTables(),
    },
    setup: () => p.setup(),
    task: () => p.task(),
    sessions: {
      hasNotice: (engineId) => p.hasNotice(engineId),
      command: (engineId) => p.command(p.engine(engineId)),
      profile: (engineId, tier) => p.profile(p.engine(engineId), tier, id),
      workDir: (base, sid) => p.workDir(base, sid),
      writeBrief: (folder, text, engineId) => p.writeBrief(folder, text, p.engine(engineId)),
      open: (o) =>
        p.open({ engine: p.engine(o.engineId), command: o.command, ...(o.env ? { env: o.env } : {}), folder: o.folder, profile: o.profile as unknown as ModelProfile }),
    },
    uiLanguage: () => p.uiLanguage(),
    dailyInput: (base, day) => p.dailyInput(base, day),
    pickImportFiles: () => p.pickImportFiles(),
    tagKey: (create) => p.tagKey(id, create),
    person: {
      data: (request, options) => p.personData(request, options ?? {}),
      note: (o) => p.saveDecision(o),
    },
  };
}
