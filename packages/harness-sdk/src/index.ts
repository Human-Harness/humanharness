import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { type Block, blockToolName } from "./block";
import { CORE_BLOCKS, INPUT_CORE_BLOCKS, RESERVED_BLOCK_NAMES } from "./core-blocks";
import { dataSchema } from "./data";

export * from "./block";
export * from "./core-blocks";
export * from "./data";
export * from "./input";
export * from "./answer";
/** The zod a manifest builds its block schemas with: the same instance the SDK validates them against. */
export { z } from "zod";

/** A harness id: lowercase letters, digits and dashes, starting with a letter. It names the app's data folder. */
export const HARNESS_ID = /^[a-z][a-z0-9-]*$/;

export * from "./language";

/** Every text in a manifest is one English string; the app translates the screens (spec 5 D1). */
const text = z.string().min(1);
export const ACTION_COSTS = ["light", "medium", "heavy"] as const;
export type ActionCost = (typeof ACTION_COSTS)[number];
/**
 * How much model a task needs (resources spec §3 D1). The core maps each tier to a model, an effort and
 * a context cap per engine; a harness never names a model. `custom` is a user setting, never a manifest value.
 */
export const TIERS = ["light", "standard", "deep"] as const;
export type Tier = (typeof TIERS)[number];
/** Where an action runs in a harness with scopes: inside the open scope, or app-wide (spec §3.3). */
export const SCOPE_MODES = ["required", "none"] as const;
export type ScopeMode = (typeof SCOPE_MODES)[number];
/**
 * A task the harness can start (a topic card, a step of the guided path, a button): its brief is the first
 * message of the task's engine session. `cost` is how much of the plan it tends to use.
 */
const actionSchema = z.object({
  label: text,
  /** One line under the label on the topic card. */
  description: text.optional(),
  /** The task brief: a file in the harness folder. It may use {{language}} and {{notesIndex}}. */
  prompt: z.string().min(1),
  cost: z.enum(ACTION_COSTS),
  /** The tier the task runs at; absent means "standard". */
  tier: z.enum(TIERS).optional(),
  /** Harnesses with `scopes` only: "required" (default) runs in the open scope, "none" app-wide (`_app`). */
  scope: z.enum(SCOPE_MODES).optional(),
});
/** A folder the agent may read but never change. */
const referenceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  label: text,
  /** "app-source" (the repository the app runs from, in development), an absolute path or a "~/" path. */
  default: z
    .string()
    .min(1)
    .refine((d) => d === "app-source" || d.startsWith("/") || d.startsWith("~/"), {
      message: 'Use "app-source", an absolute path or a path starting with ~/',
    }),
});
export type HarnessAction = z.output<typeof actionSchema>;
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;
const blockSchema = z.custom<Block>(
  (b) => {
    if (typeof b !== "object" || b === null) return false;
    const x = b as Partial<Block>;
    return (
      typeof x.description === "string" &&
      typeof x.visible === "boolean" &&
      (x.tool === undefined || (typeof x.tool === "string" && TOOL_NAME.test(x.tool))) &&
      x.schema instanceof z.ZodObject &&
      x.schema.safeParse(x.example).success &&
      (x.input === undefined || x.input instanceof z.ZodObject) &&
      (x.saveTo === undefined ||
        (typeof x.saveTo === "object" &&
          x.saveTo !== null &&
          typeof x.saveTo.collection === "string" &&
          (x.saveTo.records === undefined || typeof x.saveTo.records === "function")))
    );
  },
  { message: "Expected a block created with defineBlock()" },
);

/** The core's MCP servers (packages/blocks): a harness's own servers can't take these names. */
const RESERVED_MCP_NAMES = ["ui", "data"];

const manifestSchema = z.object({
  id: z.string().regex(HARNESS_ID),
  name: text,
  core: z.string().min(1),
  engines: z.array(z.string().min(1)).min(1),
  folder: z.object({ suggested: z.string().min(1), seed: z.string().optional(), references: z.array(referenceSchema).default([]) }),
  instructions: z.string().min(1),
  permissions: z.object({ edit: z.enum(["folder", "none"]), exec: z.boolean(), web: z.boolean() }),
  blocks: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), blockSchema),
  /** Ids are at most 64 characters: the models config keys a task's setting by its action id. */
  actions: z.record(z.string().regex(/^[a-z][a-z0-9_-]{0,63}$/), actionSchema).default({}),
  /** Optional guided order of action ids (the "Recorrido"). */
  path: z.array(z.string()).min(1).optional(),
  /** Free questions (q-<slug> tasks): the tier they run at; absent means "standard". */
  questions: z.object({ tier: z.enum(TIERS).optional() }).optional(),
  /** The harness's unit of work (a topic, a project): what the app calls it. Absent: one implicit scope (spec D2). */
  scopes: z.object({ label: text, plural: text }).optional(),
  /** Structured records the harness keeps (spec §4): collections by name. */
  data: dataSchema,
  /** One line under the name on the home screen. */
  tagline: text.optional(),
  /** How translations of this harness's screens should sound, in English ("warm and informal, short sentences"). */
  tone: z.string().min(1).max(300).optional(),
  /** Logo file in the harness folder (SVG, PNG or JPEG); defaults to the Human Harness H. */
  logo: z.string().optional(),
  mcp: z.array(z.string()).default([]),
  ui: z.string().optional(),
  locales: z.string().optional(),
  author: z.string().min(1),
  repo: z.url().optional(),
  donate: z.url().optional(),
}).superRefine((m, ctx) => {
  for (const name of Object.keys(m.blocks)) {
    if (RESERVED_BLOCK_NAMES.includes(name)) ctx.addIssue({ code: "custom", path: ["blocks", name], message: `"${name}" is a core block name` });
  }
  // Every block becomes an MCP tool: two blocks (core ones included) cannot share a tool name.
  const tools = new Map<string, string>(Object.entries({ ...CORE_BLOCKS, ...INPUT_CORE_BLOCKS }).map(([name, b]) => [blockToolName(name, b), name]));
  for (const [name, b] of Object.entries(m.blocks)) {
    const tool = blockToolName(name, b);
    const other = tools.get(tool);
    if (other !== undefined) ctx.addIssue({ code: "custom", path: ["blocks", name], message: `Tool "${tool}" is already used by block "${other}"` });
    else tools.set(tool, name);
  }
  // The harness's own MCP servers are named after its id, next to the core's `ui` and `data` servers.
  if (m.mcp.length > 0 && RESERVED_MCP_NAMES.includes(m.id)) {
    ctx.addIssue({ code: "custom", path: ["id"], message: `"${m.id}" is a built-in MCP server name and the harness's MCP servers are named after its id: use another id` });
  }
  // Free questions' model setting lives under the "questions" key, next to the action ids.
  if (Object.hasOwn(m.actions, "questions")) {
    ctx.addIssue({ code: "custom", path: ["actions", "questions"], message: '"questions" is reserved for free questions: use another action id' });
  }
  for (const [id, a] of Object.entries(m.actions)) {
    if (a.scope !== undefined && !m.scopes) {
      ctx.addIssue({ code: "custom", path: ["actions", id, "scope"], message: "Only a harness that declares scopes can set where an action runs" });
    }
  }
  const seen = new Set<string>();
  for (const id of m.path ?? []) {
    if (!Object.hasOwn(m.actions, id)) ctx.addIssue({ code: "custom", path: ["path"], message: `Unknown action in path: "${id}"` });
    if (m.actions[id]?.scope === "none") ctx.addIssue({ code: "custom", path: ["path"], message: `"${id}" runs outside any scope: it can't be in the path` });
    if (seen.has(id)) ctx.addIssue({ code: "custom", path: ["path"], message: `"${id}" is in the path twice` });
    seen.add(id);
  }
  const refs = new Set<string>();
  for (const r of m.folder.references) {
    if (refs.has(r.id)) ctx.addIssue({ code: "custom", path: ["folder", "references"], message: `Reference "${r.id}" is declared twice` });
    refs.add(r.id);
  }
  // An answer kept in data goes to a collection the harness declares (input-blocks spec §6).
  for (const [name, b] of Object.entries(m.blocks)) {
    if (b.saveTo && !Object.hasOwn(m.data, b.saveTo.collection)) {
      ctx.addIssue({ code: "custom", path: ["blocks", name, "saveTo"], message: `Collection "${b.saveTo.collection}" is not declared in data` });
    }
  }
});

export type Harness = z.output<typeof manifestSchema>;
export type HarnessInput = z.input<typeof manifestSchema>;
export type Permissions = Harness["permissions"];
export type HarnessReference = Harness["folder"]["references"][number];

export function defineHarness(config: HarnessInput): Harness {
  return manifestSchema.parse(config);
}

/** Where `action` runs: null when the harness has no scopes, else its `scope` ("required" when not set). */
export function actionScope(harness: Pick<Harness, "scopes" | "actions">, action: string): ScopeMode | null {
  if (!harness.scopes) return null;
  return harness.actions[action]?.scope ?? "required";
}

export interface LoadedHarness extends Harness {
  /** Absolute folder that contains the manifest. */
  root: string;
  /** Absolute path of the manifest file. */
  configPath: string;
}

export async function loadHarness(configPath: string, options: { root?: string } = {}): Promise<LoadedHarness> {
  const absolute = path.resolve(configPath);
  const mod = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
  if (mod.default === undefined) throw new Error(`${absolute} has no default export`);
  const harness = manifestSchema.parse(mod.default);
  const loaded: LoadedHarness = { ...harness, root: options.root ? path.resolve(options.root) : path.dirname(absolute), configPath: absolute };
  // Every task brief must live inside the harness folder.
  for (const action of Object.values(loaded.actions)) resolveInHarness(loaded, action.prompt);
  return loaded;
}

export function resolveInHarness(harness: LoadedHarness, relative: string): string {
  const resolved = path.resolve(harness.root, relative);
  const rel = path.relative(harness.root, resolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the harness folder: ${relative}`);
  }
  return resolved;
}
