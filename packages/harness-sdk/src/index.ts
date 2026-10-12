import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { type Block } from "./block";
import { CORE_BLOCK_NAMES } from "./core-blocks";

export * from "./block";
export * from "./core-blocks";

export const LANGUAGES = ["es", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export type LocalizedText = Record<Language, string>;

const localizedText = z.object({ es: z.string().min(1), en: z.string().min(1) });
export const ACTION_COSTS = ["light", "medium", "heavy"] as const;
export type ActionCost = (typeof ACTION_COSTS)[number];
/** A workflow the harness can start (e.g. from a button), with how much of the plan it tends to use. */
const actionSchema = z.object({ label: localizedText, cost: z.enum(ACTION_COSTS) });
export type HarnessAction = z.output<typeof actionSchema>;
const blockSchema = z.custom<Block>(
  (b) => {
    if (typeof b !== "object" || b === null) return false;
    const x = b as Partial<Block>;
    return (
      typeof x.description === "string" &&
      typeof x.visible === "boolean" &&
      x.schema instanceof z.ZodObject &&
      x.schema.safeParse(x.example).success
    );
  },
  { message: "Expected a block created with defineBlock()" },
);

const manifestSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: localizedText,
  core: z.string().min(1),
  languages: z.array(z.enum(LANGUAGES)).min(1),
  engines: z.array(z.string().min(1)).min(1),
  folder: z.object({ suggested: z.string().min(1), seed: z.string().optional() }),
  instructions: z.string().min(1),
  permissions: z.object({ edit: z.enum(["folder", "none"]), exec: z.boolean(), web: z.boolean() }),
  blocks: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), blockSchema),
  actions: z.record(z.string().regex(/^[a-z][a-z0-9_-]*$/), actionSchema).default({}),
  /** One line under the name on the home screen. */
  tagline: localizedText.optional(),
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
    if (CORE_BLOCK_NAMES.includes(name)) ctx.addIssue({ code: "custom", path: ["blocks", name], message: `"${name}" is a core block name` });
  }
});

export type Harness = z.output<typeof manifestSchema>;
export type HarnessInput = z.input<typeof manifestSchema>;
export type Permissions = Harness["permissions"];

export function defineHarness(config: HarnessInput): Harness {
  return manifestSchema.parse(config);
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
  return { ...harness, root: options.root ? path.resolve(options.root) : path.dirname(absolute), configPath: absolute };
}

export function resolveInHarness(harness: LoadedHarness, relative: string): string {
  const resolved = path.resolve(harness.root, relative);
  const rel = path.relative(harness.root, resolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the harness folder: ${relative}`);
  }
  return resolved;
}
