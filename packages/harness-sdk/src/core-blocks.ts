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

/** The core blocks plus the harness's own: what the agent gets as tools. */
export function allBlocks(harness: { blocks: Record<string, Block> }): Record<string, Block> {
  return { ...CORE_BLOCKS, ...harness.blocks };
}
