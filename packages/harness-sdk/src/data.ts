import { z } from "zod";

/** A collection's name: it names a file (`<collection>.json`) and appears in the agent's tools. */
export const COLLECTION_NAME = /^[a-z][a-z0-9_]{0,39}$/;
/** Names the core keeps for itself: `settings` is the harness-settings collection (harness-settings spec). */
export const RESERVED_COLLECTIONS: readonly string[] = ["settings"];
/** What the agent may do with a collection (spec §4.1). */
export const DATA_AGENT = ["write", "read", "none"] as const;
export type DataAgent = (typeof DATA_AGENT)[number];

export type DataKey = string | number;
export type DataRecord = Record<string, unknown>;
/** Who makes a request: the agent (its tools), the person (the harness UI) or the app itself. */
export type DataWho = "agent" | "person" | "app";

/** What a collection's `rules` get besides the records (spec §4.3). */
export interface RulesContext {
  /** The running task's action, when the write comes from one. */
  action?: string;
  /** The scope the write is made in (`_app` for app-wide work). */
  scope: string;
  who: DataWho;
  /** A copy of another collection's records (same scope, or app-wide), taken before the rule ran. A collection whose file was broken by hand reads as empty (the app logs it). */
  records(collection: string): DataRecord[];
}

/**
 * A pure function: `true` accepts, a string refuses with that message (the agent gets it as its tool's error).
 * `next` is null for a delete; `prev` is null for a new record.
 */
export type DataRules = (next: DataRecord | null, prev: DataRecord | null, ctx: RulesContext) => true | string;

/** Orders records for the first message: the most related to the action first (spec §4.4). */
export type DataOrder = (records: DataRecord[], ctx: { action?: string }) => DataRecord[];

const contextSchema = z.union([
  z.literal(false),
  z.object({
    fields: z.union([z.literal("all"), z.array(z.string().min(1)).min(1)]),
    tokens: z.number().int().min(50).max(4000),
    order: z.custom<DataOrder>((f) => typeof f === "function", { message: "Expected a function" }).optional(),
  }),
]);

export const collectionSchema = z
  .object({
    /** One file per scope; false: one app-wide file. */
    scoped: z.boolean(),
    /** The collection holds one record (a profile, settings). */
    single: z.boolean().default(false),
    /** The field that identifies a record; required unless `single`. */
    key: z.string().min(1).optional(),
    schema: z.custom<z.ZodObject>((s) => s instanceof z.ZodObject, { message: "Expected a z.object(...) schema" }),
    agent: z.enum(DATA_AGENT),
    /** What goes into a task's first message; false: nothing. */
    context: contextSchema.default(false),
    rules: z.custom<DataRules>((f) => typeof f === "function", { message: "Expected a function" }).optional(),
  })
  .superRefine((c, ctx) => {
    const shape = c.schema instanceof z.ZodObject ? c.schema.shape : {};
    if (!c.single && c.key === undefined) ctx.addIssue({ code: "custom", path: ["key"], message: "A collection needs a key (or single: true)" });
    if (c.key !== undefined && !Object.hasOwn(shape, c.key)) ctx.addIssue({ code: "custom", path: ["key"], message: `"${c.key}" is not a field of the schema` });
    // Keys name records (string | number); an optional, nullable or defaulted wrapper would let a record lack one.
    else if (c.key !== undefined && !(shape[c.key] instanceof z.ZodString || shape[c.key] instanceof z.ZodNumber)) {
      ctx.addIssue({ code: "custom", path: ["key"], message: `The key "${c.key}" must be a required string or number field (z.string() or z.number())` });
    }
    if (c.context !== false && c.agent === "none") {
      ctx.addIssue({ code: "custom", path: ["context"], message: 'A collection hidden from the agent (agent: "none") can\'t go into its context' });
    }
    if (c.context !== false && Array.isArray(c.context.fields)) {
      for (const f of c.context.fields) if (!Object.hasOwn(shape, f)) ctx.addIssue({ code: "custom", path: ["context", "fields"], message: `"${f}" is not a field of the schema` });
    }
  });

export type Collection = z.output<typeof collectionSchema>;
export type CollectionInput = z.input<typeof collectionSchema>;

/** The manifest's `data` (spec §4.1): collections by name. Empty by default (D2). */
export const dataSchema = z
  .record(z.string().regex(COLLECTION_NAME), collectionSchema)
  .default({})
  .superRefine((d, ctx) => {
    for (const name of Object.keys(d)) {
      if (RESERVED_COLLECTIONS.includes(name)) ctx.addIssue({ code: "custom", path: [name], message: `"${name}" is reserved by the core` });
    }
  });
