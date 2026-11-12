import { z } from "zod";
import { MOD_ID } from "./mod-json";

/** Deepest nesting a layout may have, the root being depth 1. */
export const LAYOUT_MAX_DEPTH = 8;
/** Most nodes a layout may have. */
export const LAYOUT_MAX_NODES = 64;

const nodeId = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, "A node id is lowercase letters, digits and -, at most 40");
const size = z.union([z.strictObject({ px: z.number().positive() }), z.strictObject({ weight: z.number().positive() })]);
const px = z.number().nonnegative();

/** What a block shows: a block a mod places, or the core's task view. */
export const blockContentSchema = z.union([
  z.strictObject({ mod: z.string().regex(MOD_ID), block: z.string().min(1).max(60), props: z.record(z.string(), z.unknown()).optional() }),
  z.strictObject({ core: z.literal("task") }),
]);
export type BlockContent = z.output<typeof blockContentSchema>;

const common = { id: nodeId.optional(), size: size.optional(), min: px.optional(), max: px.optional(), hidden: z.boolean().optional() };

export type LayoutNode =
  | { type: "row" | "column"; id?: string; size?: { px: number } | { weight: number }; min?: number; max?: number; hidden?: boolean; children: LayoutNode[] }
  | { type: "stack"; id?: string; size?: { px: number } | { weight: number }; min?: number; max?: number; hidden?: boolean; header?: BlockContent; children: LayoutNode[] }
  | { type: "block"; id?: string; size?: { px: number } | { weight: number }; min?: number; max?: number; hidden?: boolean; content: BlockContent };

const nodeSchema: z.ZodType<LayoutNode> = z.lazy(() =>
  z.discriminatedUnion("type", [
    z.strictObject({ type: z.enum(["row", "column"]), ...common, children: z.array(nodeSchema) }),
    z.strictObject({ type: z.literal("stack"), ...common, header: blockContentSchema.optional(), children: z.array(nodeSchema) }),
    z.strictObject({ type: z.literal("block"), ...common, content: blockContentSchema }),
  ]),
) as z.ZodType<LayoutNode>;

const isTask = (n: LayoutNode): boolean => n.type === "block" && "core" in n.content;
const taskCount = (n: LayoutNode): number => (n.type === "block" ? (isTask(n) ? 1 : 0) : n.children.reduce((s, c) => s + taskCount(c), 0));
const walk = (n: LayoutNode, f: (n: LayoutNode, depth: number) => void, depth = 1): void => {
  f(n, depth);
  if (n.type !== "block") for (const c of n.children) walk(c, f, depth + 1);
};

/** A layout file: one tree of nodes whose root is a stack (spec §5.2). Each whole-layout rule has its own message. */
export const layoutSchema = nodeSchema.superRefine((root, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: "custom", message });
  if (root.type !== "stack") return fail("The root must be a stack");
  const ids = new Map<string, number>();
  let nodes = 0;
  let depth = 0;
  walk(root, (n, d) => {
    nodes += 1;
    depth = Math.max(depth, d);
    if (n.id) ids.set(n.id, (ids.get(n.id) ?? 0) + 1);
  });
  for (const [id, n] of ids) if (n > 1) fail(`The id "${id}" is used ${n} times: ids must be unique`);
  if (depth > LAYOUT_MAX_DEPTH) fail(`The layout is ${depth} levels deep: at most ${LAYOUT_MAX_DEPTH}`);
  if (nodes > LAYOUT_MAX_NODES) fail(`The layout has ${nodes} nodes: at most ${LAYOUT_MAX_NODES}`);
  const home = root.children.find((c) => c.id === "home");
  const work = root.children.find((c) => c.id === "work");
  if (!home) fail('The root must have a child with id "home"');
  if (!work) fail('The root must have a child with id "work"');
  const total = taskCount(root);
  if (total !== 1) fail(`The layout must have exactly one { "core": "task" } block, it has ${total}`);
  else if (work && taskCount(work) !== 1) fail('The { "core": "task" } block must be inside the "work" child');
});

export type Layout = LayoutNode;
