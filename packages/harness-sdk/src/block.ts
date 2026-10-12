import type { z } from "zod";

/** A piece of UI the agent can show (visible) or update (state-only) through an MCP tool. */
export interface Block<S extends z.ZodObject = z.ZodObject> {
  description: string;
  visible: boolean;
  schema: S;
  example: z.infer<S>;
  /** The MCP tool's name. Default: `show_<name>` for visible blocks, `update_<name>` for state-only ones. */
  tool?: string;
}

export function defineBlock<S extends z.ZodObject>(block: Block<S>): Block<S> {
  const result = block.schema.safeParse(block.example);
  if (!result.success) throw new Error(`The block example does not match its schema: ${result.error.message}`);
  return block;
}

/** Name of the MCP tool the agent calls for a block. */
export function blockToolName(name: string, block: Pick<Block, "visible" | "tool">): string {
  return block.tool ?? `${block.visible ? "show" : "update"}_${name}`;
}
