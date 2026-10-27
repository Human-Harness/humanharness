import type { MaterialStage } from "@humanharness/harness-sdk";
import type { z } from "zod";
import { BATCH } from "./constants";
import { applyReview, reviewAnswer, reviewPrompt, reviewSet } from "./review";
import type { MaterialStore } from "./store";
import type { ConvertSettings } from "./types";

/** One unit of AI work (§6.2, §10): a source's stage, or the scope's sheet or links. */
export interface Job {
  scope: string;
  source?: string;
  stage: MaterialStage;
}

/**
 * The next job in a scope (§10 order): the first validating source's stage, in the order sources were added; once
 * none is left, what the scope's `.stale` marker says: the sheet, then (with items) the links. `skip`: jobs the
 * caller steps past (ones that just ran without moving on), so the next one comes instead.
 */
export async function nextJob(store: MaterialStore, o: { items: boolean; skip?: (job: Job) => boolean }): Promise<Job | null> {
  const skip = o.skip ?? (() => false);
  for (const s of await store.sources()) {
    if (s.status !== "validating" || !s.stage) continue;
    const job: Job = { scope: store.scope, source: s.id, stage: s.stage };
    if (!skip(job)) return job;
  }
  const stale = await store.stale();
  const job: Job | null = stale === "sheet" ? { scope: store.scope, stage: "sheet" } : stale === "link" && o.items ? { scope: store.scope, stage: "link" } : null;
  return job && !skip(job) ? job : null;
}

/** A job's key for a skip list (`scope:source:stage`; no source for the scope's stages). */
export const jobKey = (job: Job): string => `${job.scope}:${job.source ?? ""}:${job.stage}`;

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
  /** Converts the job's source again with other settings (§6.2 `reconvert`); its review starts over. */
  reconvert?: (settings: ConvertSettings) => Promise<void>;
}

/** What a stage's tool calls left, per run. */
export interface StageState {
  store: MaterialStore;
  job: Job;
  answers: Record<string, unknown>[];
}

/**
 * What a stage needs to run: its tools, its prompt, how to take each tool call, and what to do with the answers.
 * Stage tasks (18–23) register theirs in STAGES, and their tools in `STAGE_TOOLS`. `apply` must move the source on
 * (its stage, its queue): a job that leaves the source as it was is skipped until the next kick.
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

/** A tool only the AI stages get (system mode): what it says, and its input. */
export interface StageTool {
  description: string;
  input: z.ZodRawShape;
}

/** The system-mode tools of the `material` server (server.ts registers the ones a stage names). */
export const STAGE_TOOLS: Record<string, StageTool> = {};

// Review (§6.2): the flagged fragments plus a sample, in batches of BATCH; the program carries out the decisions.
STAGE_TOOLS.material_review = {
  description: "Your answer for this batch: the verdict, a decision per fragment, the issues. Call it once.",
  input: reviewAnswer.shape,
};

STAGES.review = {
  tools: ["material_review"],
  async prompt(store, job) {
    const s = await store.source(job.source ?? "");
    if (!s) return null;
    let queue = s.reviewQueue;
    if (!Array.isArray(queue) || queue.length === 0) {
      const next = await reviewSet(store, s);
      queue = next;
      if (next.length) await store.patch(s.id, (e) => ({ ...e, reviewQueue: next }));
    }
    return queue.length === 0 ? null : reviewPrompt(store, s, queue.slice(0, BATCH));
  },
  async accept(name, args, state) {
    const a = reviewAnswer.parse(args);
    const s = await state.store.source(state.job.source ?? "");
    const batch = new Set((s?.reviewQueue ?? []).slice(0, BATCH));
    const outside = a.fragments.find((d) => !batch.has(d.id));
    if (outside) throw new Error(`${outside.id} is not in this batch`);
    state.answers.push({ name, ...a });
    return "Saved.";
  },
  async apply(store, job, state, ctx) {
    const s = await store.source(job.source ?? "");
    if (!s) return false;
    if ((s.reviewQueue ?? []).length === 0) {
      // Nothing to review (no fragments, or none flagged since): straight to labelling.
      await store.patch(s.id, (e) => (e.status === "validating" && e.stage === "review" ? { ...e, stage: "label" } : e));
      return true;
    }
    const answer = state.answers.at(-1);
    if (!answer) return false;
    await applyReview(store, job, reviewAnswer.parse(answer), { items: ctx.items !== undefined, ...(ctx.reconvert ? { reconvert: ctx.reconvert } : {}) });
    return true;
  },
};
