import { z } from "zod";
import { type Block, defineBlock } from "./block";
import { JOB_RESULT_TOOL } from "./jobs";
import { MODE_ID, hasModes } from "./modes";
import { PHASE_ID, hasPhases } from "./phases";
import { STEP_OUTPUT_TOOL } from "./recipes";
import { REVIEW_TOOLS } from "./review";

/** One way to continue: `followUp` stays on the topic, `action` starts another task, `next: true` follows the guided path. */
export const choiceOptionSchema = z.object({
  label: z.string().min(1).max(160),
  followUp: z.string().min(1).max(2000).optional(),
  action: z.string().regex(/^[a-z][a-z0-9_-]*$/).optional(),
  next: z.literal(true).optional(),
});
export type ChoiceOption = z.infer<typeof choiceOptionSchema>;

export const choicesSchema = z.object({ options: z.array(choiceOptionSchema).min(1).max(4) });

/** What a task made clear. The app validates it and writes it to `.harness/notes/`. */
export const saveNoteSchema = z.object({
  title: z.string().min(1).max(120),
  summary: z.array(z.string().min(1).max(400)).min(1).max(5),
  decisions: z.array(z.string().min(1).max(400)).max(10),
  files: z.array(z.string().min(1).max(300)).max(20),
  open: z.array(z.string().min(1).max(400)).max(10),
});
export type SavedNote = z.infer<typeof saveNoteSchema>;

/** Blocks every harness has. Their names are reserved. */
export const CORE_BLOCKS = {
  choices: defineBlock({
    description:
      "Ends every answer: offers the person up to 4 ways to continue. `label` is what the person reads. An option with `followUp` stays on this topic (the app sends that text as the person's next message); `action` starts another topic by its id; `next: true` moves on to the next topic of the guided path. If an option has several, the app uses `action`, then `next`, then `followUp`; an option with only a `label` is a follow-up whose text is its label.",
    visible: true,
    schema: choicesSchema,
    example: {
      options: [
        { label: "Go deeper: what happens when a turn is cancelled", followUp: "Explain what happens when the person cancels a turn halfway." },
        { label: "Next topic →", next: true },
      ],
    },
  }),
  save_note: defineBlock({
    description:
      "Saves what this topic made clear, only when the app asks you to close the topic. Write the note in English. The app writes it into the folder: never write it yourself. `summary`: at most 5 short key points; `decisions`: what was settled; `files`: paths that back the summary; `open`: questions left open.",
    visible: false,
    tool: "save_note",
    schema: saveNoteSchema,
    example: {
      title: "A turn end to end",
      summary: ["ui → shell → runtime → engine CLI; events come back"],
      decisions: [],
      files: ["packages/runtime/src/runtime.ts"],
      open: [],
    },
  }),
} satisfies Record<string, Block>;

export const CORE_BLOCK_NAMES: readonly string[] = Object.keys(CORE_BLOCKS);

/** Marks on the person's own words (input-blocks spec §7). */
export const annotateSchema = z.object({
  /** The answered block's id, or "last": the latest answer before this block. */
  ref: z.string().min(1).max(200),
  /** The answer's field the marks are on. Default: its longest text. */
  field: z.string().min(1).max(64).optional(),
  marks: z
    .array(
      z.object({
        quote: z.string().min(1).max(500),
        kind: z.enum(["ok", "gap", "wrong", "note"]),
        comment: z.string().min(1).max(500).optional(),
      }),
    )
    .min(1)
    .max(30),
});
export type Annotation = z.infer<typeof annotateSchema>;

/** Core blocks only a harness with input blocks gets (annotate works on answers, spec §11.4). Their names are reserved for all. */
export const INPUT_CORE_BLOCKS = {
  annotate: defineBlock({
    description:
      "Marks parts of the person's answer to an input block. `ref`: that block's `blockId`, or \"last\" for the latest answer. `field`: the answer's field (default: its longest text). Each mark quotes the person's exact words and says if they are `ok`, a `gap` (something missing), `wrong`, or a `note`, optionally with a short `comment`.",
    visible: true,
    schema: annotateSchema,
    example: { ref: "last", marks: [{ quote: "two halves", kind: "ok", comment: "Right: two halves make a whole." }] },
  }),
} satisfies Record<string, Block>;

/** The agent's recommendation of a mode (task-modes spec §4). The person picks; the app switches. */
export const recommendModeSchema = z.object({
  recommended: z.string().regex(MODE_ID),
  reasons: z.array(z.string().min(1).max(300)).min(1).max(3),
  alternatives: z
    .array(z.object({ mode: z.string().regex(MODE_ID), why: z.string().min(1).max(300) }))
    .max(2)
    .optional(),
});
export type ModeRecommendation = z.infer<typeof recommendModeSchema>;

/** Core blocks only a harness with modes gets (spec §4). Their names are reserved for all. */
export const MODE_CORE_BLOCKS = {
  recommend_mode: defineBlock({
    description:
      "Recommends how to work in this task: `recommended` is one of this task's mode ids, with up to 3 short `reasons`, and up to 2 `alternatives` (`mode`, `why`). The person picks a mode; never switch on your own. Use it when the app asks you to recommend, or when another mode would clearly help now; then end your answer and wait.",
    visible: true,
    schema: recommendModeSchema,
    example: {
      recommended: "socratic",
      reasons: ["The topic has one key idea you can discover"],
      alternatives: [{ mode: "worked", why: "If you prefer to see it solved first" }],
    },
  }),
} satisfies Record<string, Block>;

/** The agent asks the app to move the task to another of its phases (task-phases spec §4.1). The app decides. */
export const setPhaseSchema = z.object({
  to: z.string().regex(PHASE_ID),
  reason: z.string().min(1).max(300),
});
export type PhaseRequest = z.infer<typeof setPhaseSchema>;

/** Core blocks only a harness with phases gets (spec §4.1). Their names are reserved for all. */
export const PHASE_CORE_BLOCKS = {
  set_phase: defineBlock({
    description:
      "Asks the app to move this task to another of its parts. `to`: a part id the app gave you; in the last part, its own id means the task is done. `reason`: one short sentence the person may read. Call it once, at the end of your answer, then stop: the app acts after your answer and may ask the person first.",
    visible: false,
    tool: "set_phase",
    schema: setPhaseSchema,
    example: { to: "main", reason: "The warm-up questions are done" },
  }),
} satisfies Record<string, Block>;

/** Every core block name, offered or not, the job slot's `job_result` and the step slot's `step_output` tools: no harness block may take one. */
export const RESERVED_BLOCK_NAMES: readonly string[] = [
  ...CORE_BLOCK_NAMES,
  ...Object.keys(INPUT_CORE_BLOCKS),
  ...Object.keys(MODE_CORE_BLOCKS),
  ...Object.keys(PHASE_CORE_BLOCKS),
  JOB_RESULT_TOOL,
  STEP_OUTPUT_TOOL,
  // The agent's review tools (review spec §4): not blocks, but no block may take their names.
  ...REVIEW_TOOLS,
];

export const hasInputBlocks = (blocks: Record<string, Block>): boolean => Object.values(blocks).some((b) => b.input !== undefined);

/**
 * The core blocks plus the harness's own: what the agent gets as tools. `annotate` only with input blocks (input-blocks
 * D0), `recommend_mode` only with modes (task-modes D0), `set_phase` only with phases (task-phases D0).
 */
export function allBlocks(harness: {
  blocks: Record<string, Block>;
  modes?: Record<string, unknown>;
  actions?: Record<string, { phases?: readonly unknown[] }>;
}): Record<string, Block> {
  return {
    ...CORE_BLOCKS,
    ...(hasInputBlocks(harness.blocks) ? INPUT_CORE_BLOCKS : {}),
    ...(hasModes(harness) ? MODE_CORE_BLOCKS : {}),
    ...(harness.actions && hasPhases({ actions: harness.actions }) ? PHASE_CORE_BLOCKS : {}),
    ...harness.blocks,
  };
}
