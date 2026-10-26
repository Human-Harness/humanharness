import { z } from "zod";
import { type Block, defineBlock } from "./block";

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
      "Saves what this topic made clear, only when the app asks you to close the topic. The app writes the note into the folder: never write it yourself. `summary`: at most 5 short key points; `decisions`: what was settled; `files`: paths that back the summary; `open`: questions left open.",
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
      "Marks parts of the person's answer to an input block. `ref`: that block's `blockId`, or \"last\" for the latest answer. `field`: the answer's field (default: its longest text). Each mark quotes the person's exact words and says if they are `ok`, a `gap` (something missing), `wrong`, or a `note`, with a short `comment`.",
    visible: true,
    schema: annotateSchema,
    example: { ref: "last", marks: [{ quote: "two halves", kind: "ok", comment: "Right: two halves make a whole." }] },
  }),
} satisfies Record<string, Block>;

/** Every core block name, offered or not: no harness block may take one. */
export const RESERVED_BLOCK_NAMES: readonly string[] = [...CORE_BLOCK_NAMES, ...Object.keys(INPUT_CORE_BLOCKS)];

export const hasInputBlocks = (blocks: Record<string, Block>): boolean => Object.values(blocks).some((b) => b.input !== undefined);

/** The core blocks plus the harness's own: what the agent gets as tools. `annotate` only with input blocks (spec D0). */
export function allBlocks(harness: { blocks: Record<string, Block> }): Record<string, Block> {
  return { ...CORE_BLOCKS, ...(hasInputBlocks(harness.blocks) ? INPUT_CORE_BLOCKS : {}), ...harness.blocks };
}
