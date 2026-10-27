import type { MaterialStage } from "@humanharness/harness-sdk";
import type { MaterialStore } from "./store";

/** One unit of AI work (§6.2, §10): a source's stage, or the scope's sheet or links. */
export interface Job {
  scope: string;
  source?: string;
  stage: MaterialStage;
}

/**
 * The next job in a scope (§10 order): the first validating source's stage, in the order sources were added; once
 * none is left, what the scope's `.stale` marker says: the sheet, then (with items) the links.
 */
export async function nextJob(store: MaterialStore, o: { items: boolean }): Promise<Job | null> {
  const s = (await store.sources()).find((x) => x.status === "validating" && x.stage);
  if (s?.stage) return { scope: store.scope, source: s.id, stage: s.stage };
  const stale = await store.stale();
  if (stale === "sheet") return { scope: store.scope, stage: "sheet" };
  return stale === "link" && o.items ? { scope: store.scope, stage: "link" } : null;
}

/**
 * A stage that failed (out of quota, the engine missing, a crash, no answer): not retried on its own (§13). The
 * source stays usable with what it has (`ready`, fragments `not-reviewed` or unlabelled) and says so; Try again
 * (`retryStage`) sends it back. The scope's sheet and links still run.
 */
export async function failStage(store: MaterialStore, job: Job): Promise<void> {
  if (job.source) {
    await store.patch(job.source, (s) => {
      const { stage: _stage, ...rest } = s;
      return { ...rest, status: "ready", failed: job.stage };
    });
    await store.setStale("sheet");
  }
  await store.writeIndex();
}

/** Try again (§11): the failed stage runs once more. False when the source has no failed stage. */
export async function retryStage(store: MaterialStore, sourceId: string): Promise<boolean> {
  const s = await store.source(sourceId);
  if (!s?.failed) return false;
  const stage = s.failed === "sheet" || s.failed === "link" ? undefined : s.failed;
  await store.patch(sourceId, (e) => {
    const { failed: _f, ...rest } = e;
    return stage ? { ...rest, status: "validating", stage } : rest;
  });
  if (!stage) await store.setStale("sheet");
  return true;
}

/** What the harness says about material, for prompts. */
export interface StageContext {
  fragmentKinds: string[];
  sheetSections: { id: string; label: string; prompt: string }[];
  sheetMaxTokens: number;
  /** `key: label` lines of the items collection in this scope (links stage). */
  items?: { key: string; label: string }[];
}

/** What a stage's tool calls left, per run. */
export interface StageState {
  store: MaterialStore;
  job: Job;
  answers: Record<string, unknown>[];
}

/**
 * What a stage needs to run: its tools, its prompt, how to take each tool call, and what to do with the answers.
 * Stage tasks (18–23) register theirs in STAGES, and their tools in `STAGE_TOOLS` (server.ts).
 */
export interface StageDef {
  tools: readonly string[];
  /** Null: nothing to do (the stage is applied at once, with no session). */
  prompt(store: MaterialStore, job: Job, ctx: StageContext): Promise<string | null>;
  /** One tool call from the AI; the answer goes back to it. A throw is a refusal it reads. */
  accept(name: string, args: Record<string, unknown>, state: StageState): Promise<string>;
  /** After the session ended well: apply what was accepted. False: no usable answer (the stage failed). */
  apply(store: MaterialStore, job: Job, state: StageState, ctx: StageContext): Promise<boolean>;
}

/** The stages that exist so far (Tasks 18–23 fill it). */
export const STAGES: Partial<Record<MaterialStage, StageDef>> = {};
