import { z } from "zod";
import type { Language, LocalizedText } from "./index";

/** How the core form draws a field (input-blocks spec §5). */
export const INPUT_KINDS = ["text", "longText", "number", "choice", "multiChoice", "pairs", "boolean"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/** How the core form draws one field of `input`. Everything is optional: without it, the form guesses from the zod type. */
export interface InputFieldUi {
  /** String fields only: one line, a growing textarea, or a choice among `optionsFrom`. */
  kind?: "text" | "longText" | "choice";
  label?: LocalizedText;
  /** A string field drawn as a choice: the field of the shown data (`schema`) that holds the options, a string array. */
  optionsFrom?: string;
  /** `pairs` fields: each column's label, by the inner field's name. */
  columns?: Record<string, LocalizedText>;
}

/** What a `skippable` block gets when the person skips it (spec §6 "Cancel"). */
export type SkippedAnswer = { skipped: true };

/** A piece of UI the agent can show (visible) or update (state-only) through an MCP tool. */
export interface Block<S extends z.ZodObject = z.ZodObject, I extends z.ZodObject = z.ZodObject> {
  description: string;
  visible: boolean;
  schema: S;
  example: z.infer<S>;
  /** The MCP tool's name. Default: `show_<name>` for visible blocks, `update_<name>` for state-only ones. */
  tool?: string;
  /** What the person answers (input-blocks spec D1): a zod object, checked in the main process. Absent: the block only shows. */
  input?: I;
  /** How the core form draws each field of `input`. */
  inputUi?: Partial<Record<keyof z.infer<I> & string, InputFieldUi>>;
  /** The send button's text. Default: "Enviar" / "Send". */
  submitLabel?: LocalizedText;
  /** The person may skip the question: the answer is then `{ skipped: true }`. */
  skippable?: boolean;
  /**
   * The chat's line for an answer, instead of the core's. Harness code run in the main process: pure, synchronous
   * and fast. It gets a copy of the value; anything but a non-empty string falls back to the core's line.
   */
  display?(value: z.infer<I> | SkippedAnswer, language: Language): string;
}

/** A block the person answers. */
export type InputBlock = Block & { input: z.ZodObject };

export const isInputBlock = (b: Block): b is InputBlock => b.input !== undefined;

/** The blocks of `blocks` that declare an input, by name ({} when none: spec D0). */
export function inputBlocks(blocks: Record<string, Block>): Record<string, InputBlock> {
  return Object.fromEntries(Object.entries(blocks).filter((e): e is [string, InputBlock] => isInputBlock(e[1])));
}

export function defineBlock<S extends z.ZodObject, I extends z.ZodObject = z.ZodObject>(block: Block<S, I>): Block<S, I> {
  const result = block.schema.safeParse(block.example);
  if (!result.success) throw new Error(`The block example does not match its schema: ${result.error.message}`);
  if (block.input === undefined) {
    if (block.inputUi !== undefined || block.submitLabel !== undefined || block.skippable !== undefined || block.display !== undefined) {
      throw new Error("inputUi, submitLabel, skippable and display need an input");
    }
    return block;
  }
  if (!(block.input instanceof z.ZodObject)) throw new Error("A block's input must be a z.object(...) schema");
  for (const field of Object.keys(block.inputUi ?? {})) {
    if (!Object.hasOwn(block.input.shape, field)) throw new Error(`inputUi.${field}: "${field}" is not a field of the block's input`);
  }
  return block;
}

/** Name of the MCP tool the agent calls for a block. */
export function blockToolName(name: string, block: Pick<Block, "visible" | "tool">): string {
  return block.tool ?? `${block.visible ? "show" : "update"}_${name}`;
}
