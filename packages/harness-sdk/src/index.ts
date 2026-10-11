import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";

export const LANGUAGES = ["es", "en"] as const;
export type Language = (typeof LANGUAGES)[number];
export type LocalizedText = Record<Language, string>;

/** A piece of UI the agent can show (visible) or update (state-only) through an MCP tool. */
export interface Block<S extends z.ZodObject = z.ZodObject> {
  description: string;
  visible: boolean;
  schema: S;
  example: z.infer<S>;
}

export function defineBlock<S extends z.ZodObject>(block: Block<S>): Block<S> {
  const result = block.schema.safeParse(block.example);
  if (!result.success) throw new Error(`The block example does not match its schema: ${result.error.message}`);
  return block;
}

/** Name of the MCP tool the agent calls for a block. */
export function blockToolName(name: string, block: Pick<Block, "visible">): string {
  return `${block.visible ? "show" : "update"}_${name}`;
}

const localizedText = z.object({ es: z.string().min(1), en: z.string().min(1) });
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
  mcp: z.array(z.string()).default([]),
  ui: z.string().optional(),
  locales: z.string().optional(),
  author: z.string().min(1),
  repo: z.url().optional(),
  donate: z.url().optional(),
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

export async function loadHarness(configPath: string): Promise<LoadedHarness> {
  const absolute = path.resolve(configPath);
  const mod = (await import(pathToFileURL(absolute).href)) as { default?: unknown };
  if (mod.default === undefined) throw new Error(`${absolute} has no default export`);
  const harness = manifestSchema.parse(mod.default);
  return { ...harness, root: path.dirname(absolute), configPath: absolute };
}

export function resolveInHarness(harness: LoadedHarness, relative: string): string {
  const resolved = path.resolve(harness.root, relative);
  const rel = path.relative(harness.root, resolved);
  if (rel === ".." || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Path escapes the harness folder: ${relative}`);
  }
  return resolved;
}
