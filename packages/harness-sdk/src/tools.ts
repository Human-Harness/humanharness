import { z } from "zod";
import { HOST_PATTERN, checkSchemaSubset, execPattern, tidyJsonSchema } from "./plugin";
import type { ActionLike } from "./steps";
import type { ToolDefinition } from "./tool";

/** A tool id: the action-id pattern (tools spec §3, Decision 1). It names the agent's MCP tool and `dist/tools/<id>.js`. */
export const TOOL_ID = /^[a-z][a-z0-9_-]{0,63}$/;
/** At most this many tools per harness. */
export const TOOLS_MAX = 50;
/** The core's MCP servers: a tool id can't take one of these names. */
export const CORE_SERVER_NAMES = ["ui", "data", "translate", "review", "material", "tools"] as const;

/** The manifest's `tools`: id → a tool file relative to the harness folder (tools spec §3). */
export const toolsSchema = z
  .record(z.string().regex(TOOL_ID), z.string().regex(/^\.\/[^:]*\.(ts|mts|js|mjs)$/, "A relative ./ path to a .ts, .mts, .js or .mjs file"))
  .refine((t) => Object.keys(t).length <= TOOLS_MAX, { message: `at most ${TOOLS_MAX} tools` });

/** The harness declares at least one tool. False: no slice-2 code runs (D0). */
export const hasTools = (h: { tools?: Record<string, string> }): boolean => !!h.tools && Object.keys(h.tools).length > 0;

/**
 * The size caps on `uses` in tools.json, matching the manifest's and the plugins' limits: a host name (253) and its port,
 * a secret id (40, as PLUGIN_LOCAL_ID), a command (64, as EXEC_CMD) and its tokens (20 × 200), a collection name (40, as
 * COLLECTION_NAME). The patterns themselves are toolProblems' (each with its own message); the caps keep a huge value from
 * reaching those messages.
 */
const usesJson = z.strictObject({
  hosts: z.array(z.string().max(260)).max(20).optional(),
  secrets: z.array(z.string().max(40)).max(10).optional(),
  exec: z.array(z.strictObject({ cmd: z.string().max(64), args: z.array(z.string().max(200)).max(20) })).max(10).optional(),
  data: z.strictObject({ read: z.array(z.string().max(40)).max(50).optional(), write: z.array(z.string().max(40)).max(50).optional() }).optional(),
  files: z.enum(["read", "write"]).optional(),
});
/** One tool's entry in `dist/tools.json` (tools spec §3.2): what the build read from its `defineTool`. */
export const toolMetaSchema = z.strictObject({
  description: z.string().min(1).max(1000),
  agent: z.enum(["call", "none"]),
  uses: usesJson,
  /** JSON Schema of the params. */
  params: z.record(z.string(), z.unknown()),
  /** JSON Schema of the result; absent: unchecked. */
  returns: z.record(z.string(), z.unknown()).optional(),
  timeout: z.int().min(1).max(120),
  /** Relative to dist/: `tools/<id>.js`. */
  file: z.string().regex(/^tools\/[a-z][a-z0-9_-]{0,63}\.js$/),
});
/** `dist/tools.json`, written by `humanharness build` and read by the app at start (tools spec §3.2). */
export const toolsJsonSchema = z.strictObject({
  version: z.literal(1),
  tools: z.record(z.string().regex(TOOL_ID), toolMetaSchema).refine((t) => Object.keys(t).length <= TOOLS_MAX, { message: `at most ${TOOLS_MAX} tools` }),
});
export type ToolsJson = z.output<typeof toolsJsonSchema>;
export type ToolMeta = z.output<typeof toolMetaSchema>;

type SchemaNode = Record<string, unknown>;
const isNode = (v: unknown): v is SchemaNode => typeof v === "object" && v !== null && !Array.isArray(v);

/** Where in `schema` the allowlist's refusal sits ("params.properties.x"), and why: the deepest part that fails alone. */
function schemaProblem(schema: unknown, at: string): string | null {
  const why = checkSchemaSubset(schema);
  if (!why) return null;
  if (isNode(schema)) {
    const children: [string, unknown][] = [];
    if (isNode(schema.properties)) for (const [k, v] of Object.entries(schema.properties)) children.push([`${at}.properties.${k}`, v]);
    if (Object.hasOwn(schema, "items")) children.push([`${at}.items`, schema.items]);
    if (Array.isArray(schema.anyOf)) schema.anyOf.forEach((v, i) => children.push([`${at}.anyOf.${i}`, v]));
    for (const [where, child] of children) {
      const inner = schemaProblem(child, where);
      if (inner) return inner;
    }
  }
  return `${at}: ${why}`;
}

/** A zod schema as the plugins' allowlisted JSON Schema (Decision 4), or an error naming the tool and the path. */
function toolSchema(id: string, at: "params" | "returns", s: z.ZodType): Record<string, unknown> {
  let json: unknown;
  try {
    json = z.toJSONSchema(s, { target: "draft-2020-12", unrepresentable: "throw", ...(at === "params" ? { io: "input" as const } : {}) });
  } catch (err) {
    throw new Error(`${id}: ${at}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const { $schema: _drop, ...rest } = tidyJsonSchema(json) as SchemaNode;
  const why = schemaProblem(rest, at);
  if (why) throw new Error(`${id}: ${why}`);
  return rest;
}

/**
 * A `defineTool` result as its `dist/tools.json` entry (tools spec §3.2). Pure; `humanharness build` runs it inside the
 * tool's own Node bundle, so `params instanceof z.ZodObject` and `z.toJSONSchema` use the tool's zod.
 */
export function toolMeta(id: string, def: unknown): ToolMeta {
  const d = def as Partial<ToolDefinition> | null;
  if (typeof d !== "object" || d === null || typeof d.run !== "function") throw new Error(`${id}: the default export is not defineTool({ ... })`);
  if (typeof d.description !== "string" || d.description.length === 0) throw new Error(`${id}: description is missing`);
  if (!(d.params instanceof z.ZodObject)) throw new Error(`${id}: params is not z.object({ ... })`);
  return {
    description: d.description,
    agent: d.agent ?? "call",
    uses: d.uses ?? {},
    params: toolSchema(id, "params", d.params),
    ...(d.returns ? { returns: toolSchema(id, "returns", d.returns) } : {}),
    timeout: d.timeout ?? 30,
    file: `tools/${id}.js`,
  };
}

/** What `toolProblems` reads of the manifest. */
export interface ToolsManifest {
  permissions: { edit: "folder" | "none"; exec: boolean; web: boolean };
  data: Record<string, unknown>;
  secrets?: readonly { id: string }[];
  tools?: Record<string, string>;
  /** Setup steps: a connect step's `test` names a tool run with {} (tools spec §9). */
  setup?: readonly { kind: string; test?: string }[];
  /** The actions' pre-steps and phases' expects: main checks them against tools.json with `stepProblems` (tools spec §3.3). */
  actions?: Record<string, ActionLike>;
}
/** A problem of one tool: its id and an English line that starts with it. */
export interface ToolProblem {
  tool: string;
  message: string;
}
/** The shortest description an `agent: "call"` tool has: the agent picks tools by it. */
export const TOOL_DESCRIPTION_MIN = 20;

/**
 * A `uses.hosts` pattern (already HOST_PATTERN) names a public host: not localhost or a name under it, and not an IP
 * literal, which a URL reads as an address when its last label is a number (decimal or 0x hex: "127.1", "2130706433",
 * "0x7f.1"). The broker refuses these at every call too; here the author hears it at check time.
 */
function publicHostName(pattern: string): boolean {
  const name = pattern.replace(/^\*\./, "").replace(/:[0-9]+$/, "");
  const last = name.slice(name.lastIndexOf(".") + 1);
  return name !== "localhost" && !name.endsWith(".localhost") && !/^(0x[0-9a-f]*|[0-9]+)$/.test(last);
}

/** One tool's `uses` against the harness (tools spec §3.3): inside its permissions, patterns, collections and secrets it declares. */
function usesProblems(m: ToolsManifest, uses: ToolMeta["uses"]): string[] {
  const out: string[] = [];
  if (uses.hosts?.length && !m.permissions.web) out.push("uses.hosts needs permissions.web");
  for (const h of uses.hosts ?? []) {
    if (!HOST_PATTERN.test(h)) out.push(`uses.hosts: "${h}" is not a host pattern`);
    else if (!publicHostName(h)) out.push(`uses.hosts: "${h}" is not a public host name`);
  }
  if (uses.exec?.length && !m.permissions.exec) out.push("uses.exec needs permissions.exec");
  for (const e of uses.exec ?? []) {
    const r = execPattern.safeParse(e);
    if (r.success) continue;
    if (r.error.issues.some((i) => i.path[0] === "cmd")) out.push(`uses.exec: "${e.cmd}" is not a bare command name`);
    for (const i of r.error.issues) if (i.path[0] !== "cmd") out.push(`uses.exec: "${e.cmd}": ${i.message}`);
  }
  // Decision 5: ctx.files.write waits for a later slice (spec §17).
  if (uses.files === "write") out.push("uses.files: write comes in a later slice; use read");
  for (const kind of ["read", "write"] as const) {
    for (const c of uses.data?.[kind] ?? []) if (!Object.hasOwn(m.data, c)) out.push(`uses.data.${kind}: "${c}" is not a collection`);
  }
  for (const s of uses.secrets ?? []) if (!m.secrets?.some((x) => x.id === s)) out.push(`uses.secrets: "${s}" is not declared in secrets`);
  return out;
}

/**
 * The checks of tools spec §3.3 that need `dist/tools.json` (slice 2): each tool's `uses` inside the harness's permissions,
 * its file, its description, and the manifest and tools.json listing the same ids. `humanharness check` reports each one;
 * the app turns tools off on any.
 */
export function toolProblems(m: ToolsManifest, json: ToolsJson): ToolProblem[] {
  const out: ToolProblem[] = [];
  const declared = Object.keys(m.tools ?? {});
  // "Test connection" runs these with {} (tools spec §9).
  const tests = new Set((m.setup ?? []).flatMap((s) => (s.kind === "connect" && s.test !== undefined ? [s.test] : [])));
  for (const id of declared) if (!Object.hasOwn(json.tools, id)) out.push({ tool: id, message: `${id}: not built (run humanharness build)` });
  for (const [id, t] of Object.entries(json.tools)) {
    const add = (message: string) => out.push({ tool: id, message: `${id}: ${message}` });
    if (!declared.includes(id)) {
      add("not a tool of this harness (run humanharness build)");
      continue;
    }
    // The registry runs tools/<id>.js under <id>'s grant: another tool's bundle must never run with it.
    if (t.file !== `tools/${id}.js`) add(`file is "${t.file}", not "tools/${id}.js" (run humanharness build)`);
    for (const p of usesProblems(m, t.uses)) add(p);
    const text = t.description.trim();
    if (t.agent === "call" && (text.length < TOOL_DESCRIPTION_MIN || text === id)) {
      add(`an agent: call tool needs a description of at least ${TOOL_DESCRIPTION_MIN} characters that says what it does`);
    }
    const required = t.params.required;
    if (tests.has(id) && Array.isArray(required) && required.length > 0) add("a connect step's test tool can't have required params");
  }
  return out;
}
