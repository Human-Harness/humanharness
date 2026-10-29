import { z } from "zod";

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

const usesJson = z.strictObject({
  hosts: z.array(z.string()).max(20).optional(),
  secrets: z.array(z.string()).max(10).optional(),
  exec: z.array(z.strictObject({ cmd: z.string(), args: z.array(z.string()) })).max(10).optional(),
  data: z.strictObject({ read: z.array(z.string()).optional(), write: z.array(z.string()).optional() }).optional(),
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
export const toolsJsonSchema = z.strictObject({ version: z.literal(1), tools: z.record(z.string().regex(TOOL_ID), toolMetaSchema) });
export type ToolsJson = z.output<typeof toolsJsonSchema>;
export type ToolMeta = z.output<typeof toolMetaSchema>;
