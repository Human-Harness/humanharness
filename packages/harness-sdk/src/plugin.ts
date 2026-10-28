import { z } from "zod";
import { type Collection, COLLECTION_NAME, collectionSchema } from "./data";
import { type HarnessSettings, SETTING_NAME, settingsSchema } from "./settings";

/** The core plugin contract version (plugins spec §3.2): a plugin built for another one can't be added. */
export const PLUGIN_API = 1;
/** A plugin id (§3.2). It names folders (`.harness/plugins/<id>/`) and the `hh-plugin://<id>/` host. */
export const PLUGIN_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** Ids inside a plugin: sources, panels, chips, actions, secrets. */
export const PLUGIN_LOCAL_ID = /^[a-z][a-z0-9_-]{0,39}$/;
/** A slot id (part 2 declares the harness's slots; the manifest only checks the shape here). */
export const SLOT_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** A command name for `exec`: a bare name, never a path (Decision 9). */
export const EXEC_CMD = /^[A-Za-z0-9._-]{1,64}$/;
/** A host pattern: `host`, `*.host` (one label or more), optional `:port`; lower case (Decision 8). */
export const HOST_PATTERN = /^(\*\.)?([a-z0-9-]+\.)+[a-z0-9-]+(:[0-9]{1,5})?$|^[a-z0-9-]+(:[0-9]{1,5})?$/;
/** The tiers of the core (index.ts TIERS; repeated here to avoid an import cycle, pinned by a test). */
export const PLUGIN_TIERS = ["light", "standard", "deep"] as const;
export const PLUGIN_JSON_MAX_BYTES = 256 * 1024;

const SCHEMA_WORDS = new Set([
  "type", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "minimum", "maximum",
  "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems", "uniqueItems",
  "default", "title", "description", "$schema",
]);
const SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "null", "array", "object"]);
/** Words that only mean something for one type: dropped when a list of types is split (`narrow`). */
const WORDS_OF: Record<string, readonly string[]> = {
  object: ["properties", "required", "additionalProperties"],
  array: ["items", "minItems", "maxItems", "uniqueItems"],
  string: ["minLength", "maxLength"],
  number: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
  integer: ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf"],
};
/** What may sit next to `anyOf`: annotations only, so a union never mixes with constraints. */
const ANNOTATIONS = new Set(["anyOf", "default", "title", "description", "$schema"]);
/** The `$schema` URIs taken, at the top only: both read exclusiveMinimum/Maximum as numbers (draft-04 does not). */
const SCHEMA_URIS = new Set(["https://json-schema.org/draft/2020-12/schema", "http://json-schema.org/draft-07/schema#", "http://json-schema.org/draft-07/schema"]);
/** Property names that would reach an object's prototype once the zod shape is built. */
const UNSAFE_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const COUNTS = ["minLength", "maxLength", "minItems", "maxItems"];
const BOUNDS = ["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum"];
const isPlain = (v: unknown) => v === null || ["string", "boolean"].includes(typeof v) || (typeof v === "number" && Number.isFinite(v));
const MAX_DEPTH = 8;
const MAX_NODES = 200;

type SchemaNode = Record<string, unknown>;

const isNode = (v: unknown): v is SchemaNode => typeof v === "object" && v !== null && !Array.isArray(v);
/** The node's type names: `type` may be one name or a list (spike S8). */
const typesOf = (node: SchemaNode): string[] => (typeof node.type === "string" ? [node.type] : Array.isArray(node.type) ? (node.type as string[]) : []);

/**
 * Null when `schema` uses only the allowlist (Decision 3), else why not. No keyword that compiles a regex in main
 * (`pattern`, `patternProperties`, `format`) or that points elsewhere (`$ref`) is accepted (B11). Object keywords
 * need `"type": "object"`, and `required` names declared properties only, so the zod we build matches the schema.
 */
export function checkSchemaSubset(schema: unknown): string | null {
  let nodes = 0;
  const walk = (node: unknown, depth: number): string | null => {
    if (!isNode(node)) return "a schema is an object";
    if (depth > MAX_DEPTH) return `the schema is too deep (more than ${MAX_DEPTH} levels)`;
    if (++nodes > MAX_NODES) return `the schema is too large (more than ${MAX_NODES} parts)`;
    for (const word of Object.keys(node)) if (!SCHEMA_WORDS.has(word)) return `"${word}" is not supported in plugin schemas`;
    const why = checkValues(node, depth);
    if (why) return why;
    if (Object.hasOwn(node, "type")) {
      const t = node.type;
      const list = typeof t === "string" ? [t] : Array.isArray(t) ? t : null;
      if (!list || list.length === 0 || list.some((x) => typeof x !== "string" || !SCHEMA_TYPES.has(x)) || new Set(list).size !== list.length) {
        return `"type" is one of ${[...SCHEMA_TYPES].join(", ")}, or a list of them`;
      }
    }
    const types = typesOf(node);
    // A node with nothing that types it would go to z.fromJSONSchema as "any value", object keys never stripped.
    if (types.length === 0 && !["enum", "const", "anyOf"].some((w) => Object.hasOwn(node, w))) return 'every schema part needs "type", "enum", "const" or "anyOf"';
    if (types.includes("array") && !Object.hasOwn(node, "items")) return '"type": "array" needs "items"';
    const object = types.includes("object");
    if (!object && WORDS_OF.object.some((w) => Object.hasOwn(node, w))) return 'properties, required and additionalProperties need "type": "object"';
    if (object && (Object.hasOwn(node, "enum") || Object.hasOwn(node, "const"))) return "enum and const take plain values, not objects";
    if (Object.hasOwn(node, "anyOf") && Object.keys(node).some((w) => !ANNOTATIONS.has(w))) return '"anyOf" goes with default, title and description only';
    if (Object.hasOwn(node, "additionalProperties") && typeof node.additionalProperties !== "boolean") return `"additionalProperties" takes true or false only`;
    const properties = node.properties;
    if (properties !== undefined) {
      if (!isNode(properties)) return `"properties" is an object`;
      for (const name of Object.keys(properties)) if (UNSAFE_NAMES.has(name)) return `"${name}" can't be a property name`;
      for (const child of Object.values(properties)) {
        const why = walk(child, depth + 1);
        if (why) return why;
      }
    }
    if (Object.hasOwn(node, "required")) {
      const req = node.required;
      if (!Array.isArray(req) || req.some((r) => typeof r !== "string")) return `"required" is a list of property names`;
      for (const r of req as string[]) if (UNSAFE_NAMES.has(r)) return `"${r}" can't be a property name`;
      for (const r of req as string[]) if (!isNode(properties) || !Object.hasOwn(properties, r)) return `"required" names "${r}", which is not in properties`;
    }
    if (Object.hasOwn(node, "items")) {
      const why = walk(node.items, depth + 1);
      if (why) return why;
    }
    if (Object.hasOwn(node, "anyOf")) {
      if (!Array.isArray(node.anyOf) || node.anyOf.length === 0) return `"anyOf" is a non-empty list`;
      for (const child of node.anyOf) {
        const why = walk(child, depth + 1);
        if (why) return why;
      }
    }
    return null;
  };
  return walk(schema, 0);
}

/** Why a keyword of `node` holds a value of the wrong kind, else null: none is dropped or thrown on later. */
function checkValues(node: SchemaNode, depth: number): string | null {
  const has = (w: string) => Object.hasOwn(node, w);
  if (has("$schema") && (depth > 0 || typeof node.$schema !== "string" || !SCHEMA_URIS.has(node.$schema))) {
    return `"$schema" goes at the top only, as draft 2020-12 or draft-07`;
  }
  for (const w of COUNTS) if (has(w) && !(Number.isInteger(node[w]) && (node[w] as number) >= 0)) return `"${w}" is a whole number, 0 or more`;
  for (const w of BOUNDS) if (has(w) && !(typeof node[w] === "number" && Number.isFinite(node[w]))) return `"${w}" is a number`;
  if (has("multipleOf") && !(typeof node.multipleOf === "number" && Number.isFinite(node.multipleOf) && node.multipleOf > 0)) return `"multipleOf" is a number over 0`;
  if (has("enum") && (!Array.isArray(node.enum) || node.enum.length === 0 || !node.enum.every(isPlain))) return `"enum" is a non-empty list of plain values`;
  if (has("const") && !isPlain(node.const)) return `"const" is a plain value`;
  if (has("uniqueItems") && typeof node.uniqueItems !== "boolean") return `"uniqueItems" takes true or false only`;
  for (const w of ["title", "description"]) if (has(w) && typeof node[w] !== "string") return `"${w}" is text`;
  return null;
}

/** An object node sits at or below `node`: it needs our own builder (spike S8). */
const hasObject = (node: SchemaNode): boolean =>
  typesOf(node).includes("object") ||
  (isNode(node.items) && hasObject(node.items)) ||
  (Array.isArray(node.anyOf) && node.anyOf.some((c) => isNode(c) && hasObject(c)));

/** `node` for one of its types: the other types' words, and the outer annotations, left out. */
function narrow(node: SchemaNode, type: string): SchemaNode {
  const drop = new Set(Object.entries(WORDS_OF).flatMap(([t, words]) => (t === type || (type === "integer" && t === "number") ? [] : words)));
  for (const w of ["default", "title", "description"]) drop.add(w);
  // A word both number and integer use stays for either.
  for (const w of WORDS_OF[type] ?? []) drop.delete(w);
  return { ...Object.fromEntries(Object.entries(node).filter(([w]) => !drop.has(w))), type };
}

const union = (options: z.ZodType[]): z.ZodType => (options.length === 1 ? options[0] : z.union(options as [z.ZodType, z.ZodType, ...z.ZodType[]]));

/**
 * One allowlisted node as zod. `z.fromJSONSchema` lets unknown object keys through (spike S8), so every object is
 * built here, as `z.object` (strips), `z.strictObject` (`additionalProperties: false`) or `z.looseObject` (`true`),
 * and so is every array or union with an object below; only nodes with no object below go to `z.fromJSONSchema`.
 */
function build(node: SchemaNode): z.ZodType {
  if (!hasObject(node)) return z.fromJSONSchema(node as never);
  const types = typesOf(node);
  let out: z.ZodType;
  if (Array.isArray(node.anyOf)) out = union(node.anyOf.map((c) => build(c as SchemaNode)));
  else if (types.length > 1) out = union(types.map((t) => build(narrow(node, t))));
  else if (types[0] === "object") {
    const properties = isNode(node.properties) ? node.properties : {};
    const required = new Set(Array.isArray(node.required) ? (node.required as string[]) : []);
    const shape = Object.fromEntries(
      Object.entries(properties).map(([name, child]) => {
        const s = build(child as SchemaNode);
        return [name, required.has(name) ? s : s.optional()];
      }),
    );
    out = node.additionalProperties === false ? z.strictObject(shape) : node.additionalProperties === true ? z.looseObject(shape) : z.object(shape);
  } else {
    // An array whose items hold an object.
    let list = z.array(build(node.items as SchemaNode));
    if (typeof node.minItems === "number") list = list.min(node.minItems);
    if (typeof node.maxItems === "number") list = list.max(node.maxItems);
    out = node.uniqueItems === true ? list.refine((xs) => new Set(xs.map((x) => JSON.stringify(x))).size === xs.length, { message: "Items must be unique" }) : list;
  }
  if (node.default !== undefined) out = out.default(structuredClone(node.default) as never);
  const meta = Object.fromEntries((["title", "description"] as const).filter((w) => typeof node[w] === "string").map((w) => [w, node[w] as string]));
  return Object.keys(meta).length > 0 ? out.meta(meta) : out;
}

/** A JSON Schema from plugin.json as zod; throws with the reason when it leaves the allowlist (Decision 3, spike S8). */
export function jsonSchemaToZod(schema: unknown): z.ZodType {
  const why = checkSchemaSubset(schema);
  if (why) throw new Error(why);
  return build(schema as SchemaNode);
}

const jsonSchema = z.custom<Record<string, unknown>>((v) => checkSchemaSubset(v) === null, {
  error: (issue) => checkSchemaSubset(issue.input) ?? "Invalid schema",
});
const objectSchema = jsonSchema.refine((s) => s.type === "object", { message: 'A collection\'s schema is { "type": "object", … }' });
const text = z.string().min(1);
/**
 * What a plugin's display text may not hold: C0/C1 controls, bidi marks, overrides and isolates, zero-width
 * characters and line separators. Shown as plain text, they could still hide words or reorder them (B12).
 */
const HIDDEN = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/;
/** Text the person reads (names, labels, titles, help): refuses what HIDDEN names. */
const shown = (s: z.ZodString) => s.refine((v) => !HIDDEN.test(v), { message: "Display text can't hold hidden or control characters" });

const pluginCollectionSchema = z.strictObject({
  /** Always app-wide: sources run outside any scope (Decision 2). */
  scoped: z.literal(false).default(false),
  single: z.boolean().default(false),
  key: z.string().min(1).optional(),
  schema: objectSchema,
  /** The agent reads it through the `data` server while the plugin is on; never writes it (§3.2). */
  agent: z.enum(["read", "none"]),
  context: z.union([z.literal(false), z.strictObject({ fields: z.union([z.literal("all"), z.array(text).min(1)]), tokens: z.number().int().min(50).max(4000) })]).default(false),
});

const execPattern = z
  .strictObject({
    cmd: z.string().regex(EXEC_CMD),
    args: z.array(z.string().min(1).max(200)).max(20),
  })
  .superRefine((p, ctx) => {
    p.args.forEach((a, i) => {
      if (a === "*" && i !== p.args.length - 1) ctx.addIssue({ code: "custom", path: ["args", i], message: "* can only be the last token" });
      if (a.includes("{{secret:")) ctx.addIssue({ code: "custom", path: ["args", i], message: "Secrets never go into a command" });
    });
  });

/** A settings field as plain data: the harness's shape with a JSON Schema; `settingsSchema` checks the rest (Decision 4). */
const settingFieldJson = z.strictObject({
  schema: jsonSchema,
  default: z.unknown().optional(),
  section: z.string().optional(),
  control: z.string(),
  label: shown(z.string()),
  help: shown(z.string()).optional(),
  unit: shown(z.string()).optional(),
  options: z.record(z.string(), shown(z.string())).optional(),
  agent: z.unknown().optional(),
  advanced: z.boolean().optional(),
});

/** Unique ids in a list, each reported once. */
function unique(list: { id: string }[], path: (string | number)[], ctx: z.RefinementCtx) {
  const seen = new Set<string>();
  list.forEach((x, i) => {
    if (seen.has(x.id)) ctx.addIssue({ code: "custom", path: [...path, i, "id"], message: `"${x.id}" is declared twice` });
    seen.add(x.id);
  });
}

export const pluginManifestSchema = z
  .strictObject({
    id: z.string().regex(PLUGIN_ID),
    name: shown(text.max(60)),
    version: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]{1,40})?$/),
    api: z.number().int(),
    /** A harness id, or "*" for any harness (§3.4). */
    harness: z.union([z.literal("*"), z.string().regex(/^[a-z][a-z0-9-]*$/)]),
    permissions: z.strictObject({
      hosts: z.array(z.string().regex(HOST_PATTERN)).max(20).default([]),
      exec: z.array(execPattern).max(10).default([]),
      secrets: z.array(z.strictObject({ id: z.string().regex(PLUGIN_LOCAL_ID), label: shown(text.max(80)), help: shown(text.max(200)).optional() })).max(10).default([]),
      tasks: z.boolean().default(false),
    }),
    sources: z.array(z.strictObject({ id: z.string().regex(PLUGIN_LOCAL_ID), ttl: z.number().int().min(10).max(604_800), workHoursOnly: z.boolean().default(false) })).max(10).default([]),
    data: z.record(z.string().regex(COLLECTION_NAME), pluginCollectionSchema).default({}),
    panels: z.array(z.strictObject({ id: z.string().regex(PLUGIN_LOCAL_ID), slot: z.string().regex(SLOT_ID), title: shown(text.max(40)) })).max(5).default([]),
    chips: z.array(z.strictObject({ id: z.string().regex(PLUGIN_LOCAL_ID), slot: z.string().regex(SLOT_ID) })).max(5).default([]),
    settings: z
      .strictObject({
        tab: shown(text.max(40)).optional(),
        sections: z.array(z.strictObject({ id: z.string().regex(PLUGIN_LOCAL_ID), label: shown(text.max(60)) })).default([]),
        fields: z.record(z.string().regex(SETTING_NAME), settingFieldJson),
      })
      .optional(),
    actions: z
      .array(
        z.strictObject({
          id: z.string().regex(PLUGIN_LOCAL_ID),
          label: shown(text.max(60)),
          tier: z.enum(PLUGIN_TIERS),
          scope: z.enum(["required", "none"]).default("required"),
          vars: objectSchema.default({ type: "object", properties: {} }),
          prompt: text.max(4000),
        }),
      )
      .max(20)
      .default([]),
  })
  .superRefine((m, ctx) => {
    unique(m.sources, ["sources"], ctx);
    unique(m.panels, ["panels"], ctx);
    unique(m.chips, ["chips"], ctx);
    unique(m.actions, ["actions"], ctx);
    unique(m.permissions.secrets, ["permissions", "secrets"], ctx);
    if (Object.keys(m.data).length > 10) ctx.addIssue({ code: "custom", path: ["data"], message: "At most 10 collections" });
    if (m.actions.length > 0 && !m.permissions.tasks) ctx.addIssue({ code: "custom", path: ["actions"], message: "Actions need permissions.tasks: true" });
  });

export type PluginManifest = z.output<typeof pluginManifestSchema>;
export type PluginPermissions = PluginManifest["permissions"];

/** plugin.json as data: throws a zod error with every issue. The api version is the loader's own check (a clearer message). */
export function parsePluginManifest(raw: unknown): PluginManifest {
  return pluginManifestSchema.parse(raw);
}

/** The plugin's collections in the harness data model (data.md), app-wide; throws on a key the model refuses. */
export function pluginCollections(m: PluginManifest): Record<string, Collection> {
  return Object.fromEntries(Object.entries(m.data).map(([name, c]) => [name, collectionSchema.parse({ ...c, schema: jsonSchemaToZod(c.schema) })]));
}

/** The plugin's settings in the harness settings model, checked by it (Decision 4); undefined without settings. */
export function pluginSettings(m: PluginManifest): HarnessSettings | undefined {
  if (!m.settings) return undefined;
  const fields = Object.fromEntries(Object.entries(m.settings.fields).map(([n, f]) => [n, { ...f, schema: jsonSchemaToZod(f.schema) }]));
  return settingsSchema.parse({ tab: m.settings.tab ?? m.name, sections: m.settings.sections, fields });
}

/** The harness's `plugins` (§3.4): bundled ids, the ones that start on, and whether the person may add local ones. */
export const harnessPluginsSchema = z
  .strictObject({
    bundled: z.array(z.string().regex(PLUGIN_ID)).max(20).default([]),
    on: z.array(z.string().regex(PLUGIN_ID)).default([]),
    local: z.boolean().default(false),
  })
  .superRefine((p, ctx) => {
    const seen = new Set<string>();
    p.bundled.forEach((id, i) => {
      if (seen.has(id)) ctx.addIssue({ code: "custom", path: ["bundled", i], message: `"${id}" is listed twice` });
      seen.add(id);
    });
    const on = new Set<string>();
    p.on.forEach((id, i) => {
      if (!seen.has(id)) ctx.addIssue({ code: "custom", path: ["on", i], message: `"${id}" is not bundled` });
      else if (on.has(id)) ctx.addIssue({ code: "custom", path: ["on", i], message: `"${id}" is listed twice` });
      on.add(id);
    });
  });
export type HarnessPlugins = z.output<typeof harnessPluginsSchema>;

/** The harness takes plugins at all (D1, D0): a bundled one or local ones. */
export const pluginsAccepted = (h: { plugins?: HarnessPlugins }): boolean => !!h.plugins && (h.plugins.bundled.length > 0 || h.plugins.local);
