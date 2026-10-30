import fs from "node:fs/promises";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { TOOL_ID, TOOLS_MAX } from "@humanharness/harness-sdk";
import { RpcRefused, RpcTimeout, callRpc } from "./bridge";

/** One tool the agent may call (tools spec §5): its id, its description and its params' JSON Schema, as built. */
export interface ToolsCatalogueEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** Bounds of the catalogue file the app writes per workspace (`HH_TOOLS`); the description's is `tools.json`'s. */
export const TOOLS_CATALOGUE_LIMITS = { bytes: 512 * 1024, tools: TOOLS_MAX, description: 1000 } as const;

/**
 * How long a call may wait for the app: longer than the longest tool timeout (120 s), so the app's own timeout
 * answers first with the tool's name in it.
 */
export const TOOLS_CALL_TIMEOUT_MS = 180_000;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** An entry with exactly the three keys, a tool id, a description within bounds and an object input schema. */
function fits(e: unknown): e is ToolsCatalogueEntry {
  if (!isObject(e)) return false;
  const keys = Object.keys(e);
  return (
    keys.length === 3 &&
    typeof e.name === "string" &&
    TOOL_ID.test(e.name) &&
    typeof e.description === "string" &&
    e.description.length > 0 &&
    e.description.length <= TOOLS_CATALOGUE_LIMITS.description &&
    isObject(e.inputSchema) &&
    e.inputSchema.type === "object"
  );
}

/**
 * The tools in `file` (≤ 512 KB, a JSON list of ≤ 50 entries). An entry that doesn't fit is dropped, a duplicate name
 * keeps the first, and a missing, oversized or broken file gives none: each case is logged on stderr, never fatal.
 * The parsed entries are kept as they are (never rebuilt key by key).
 */
export async function readToolsCatalogue(file: string): Promise<ToolsCatalogueEntry[]> {
  let list: unknown;
  try {
    const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    try {
      const st = await handle.stat();
      if (!st.isFile() || st.size > TOOLS_CATALOGUE_LIMITS.bytes) throw new Error("not a file of at most 512 KB");
      list = JSON.parse(await handle.readFile("utf8"));
    } finally {
      await handle.close();
    }
  } catch {
    // A fixed line: the parser's message would echo the file's text.
    console.error("The tools catalogue was ignored: it is missing, too big or not valid JSON");
    return [];
  }
  if (!Array.isArray(list)) {
    console.error("The tools catalogue was ignored: it is not a list");
    return [];
  }
  if (list.length > TOOLS_CATALOGUE_LIMITS.tools) {
    console.error(`The tools catalogue was ignored: it has more than ${TOOLS_CATALOGUE_LIMITS.tools} tools`);
    return [];
  }
  const out: ToolsCatalogueEntry[] = [];
  for (const e of list) {
    if (!fits(e) || out.some((o) => o.name === e.name)) {
      console.error("A tools catalogue entry was dropped");
      continue;
    }
    out.push(e);
  }
  return out;
}

/** What the agent reads when a call didn't come back with a result. */
function errorText(e: unknown): string {
  if (e instanceof RpcTimeout) return "The app did not answer in time; the tool may still have run.";
  const message = e instanceof Error ? e.message : String(e);
  return e instanceof RpcRefused ? message : `Could not reach the app (${message}). Do not retry in a loop.`;
}

/**
 * The core `tools` MCP server (tools spec §5): the harness's `agent: "call"` tools from the catalogue file the app
 * writes (`HH_TOOLS`), under their ids, with their params' JSON Schema passed as is (the low-level handlers, so no
 * schema is rebuilt). A call goes to the app over `rpc` as `{ tool, args }`, which checks and runs it for the slot
 * whose socket it came on; the result comes back as JSON text, a refusal or failure as a tool error with its message.
 */
export async function createToolsServer(catalogue: string, rpc: { path: string; token: string }): Promise<McpServer> {
  const tools = await readToolsCatalogue(catalogue);
  const server = new McpServer({ name: "tools", version: "0.1.0" });
  server.server.registerCapabilities({ tools: {} });
  server.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema as { type: "object" } })),
  }));
  server.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name;
    if (!tools.some((t) => t.name === name)) return { isError: true, content: [{ type: "text" as const, text: `No tool "${name.slice(0, 64)}"` }] };
    try {
      const result = await callRpc(rpc, { tool: name, args: request.params.arguments ?? {} }, TOOLS_CALL_TIMEOUT_MS);
      return { content: [{ type: "text" as const, text: JSON.stringify(result ?? null) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: errorText(e) }] };
    }
  });
  return server;
}
