import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Collection, type LoadedHarness, loadHarness, z } from "@humanharness/harness-sdk";
import { RpcRefused, callRpc } from "./bridge";

/** The collections the agent may see (spec §4.1: everything but `agent: "none"`), in manifest order. */
export const agentCollections = (harness: Pick<LoadedHarness, "data">): [string, Collection][] =>
  Object.entries(harness.data).filter(([, c]) => c.agent !== "none");

/** The `data` MCP server starts only when there is something for the agent to see (D2). */
export const hasAgentData = (harness: Pick<LoadedHarness, "data">): boolean => agentCollections(harness).length > 0;

type JsonSchema = {
  type?: string;
  enum?: unknown[];
  const?: unknown;
  items?: JsonSchema;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  anyOf?: JsonSchema[];
};

/** A JSON Schema node as a short type: `string`, `a|b`, `[string]`, `{k: string, n?: number}`; what it cannot show is `any`. */
function shortType(node: JsonSchema): string {
  if (node.enum) return node.enum.map((v) => String(v)).join("|");
  if (node.const !== undefined) return JSON.stringify(node.const);
  if (node.anyOf) return node.anyOf.map(shortType).join("|");
  if (node.type === "integer") return "number";
  if (node.type === "array") return `[${node.items ? shortType(node.items) : "any"}]`;
  if (node.type === "object" && node.properties) return `{${objectFields(node)}}`;
  if (node.type === "string" || node.type === "number" || node.type === "boolean" || node.type === "null") return node.type;
  return "any";
}

function objectFields(node: JsonSchema): string {
  const required = new Set(node.required ?? []);
  return Object.entries(node.properties ?? {})
    .map(([k, v]) => `${k}${required.has(k) ? "" : "?"}: ${shortType(v)}`)
    .join(", ");
}

function fieldsOf(c: Collection): string {
  try {
    return objectFields(z.toJSONSchema(c.schema, { unrepresentable: "any", io: "input" }) as JsonSchema);
  } catch {
    return Object.keys(c.schema.shape).join(", ");
  }
}

/** One line per collection: name, key, where it lives, what the agent may do, and its fields. */
function catalogue(collections: [string, Collection][]): string {
  return collections
    .map(
      ([name, c]) =>
        `- ${name} (${c.single ? "one record" : `key ${c.key}`}, ${c.scoped ? "scoped" : "app-wide"}, ${c.agent === "write" ? "read+write" : "read"}): ${fieldsOf(c)}`,
    )
    .join("\n");
}

const names = (list: [string, Collection][]) => list.map(([n]) => n) as [string, ...string[]];
const key = z.union([z.string(), z.number()]);
const fields = z.record(z.string(), z.unknown());

/**
 * The agent's data tools (spec §4.4). Each call goes to the app over `rpc`, which runs it as the agent in the
 * running task's scope, with every check; a refusal comes back as a tool error.
 */
export async function createDataServer(harnessConfig: string, rpc: { path: string; token: string }): Promise<McpServer> {
  const harness = await loadHarness(harnessConfig);
  const visible = agentCollections(harness);
  if (visible.length === 0) throw new Error("No collection is available to the agent");
  const writable = visible.filter(([, c]) => c.agent === "write");
  const server = new McpServer({ name: "data", version: "0.1.0" });

  const call = (op: string) => async (args: Record<string, unknown>) => {
    try {
      const result = await callRpc(rpc, { op, ...args });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const text = e instanceof RpcRefused ? `Refused: ${message}` : `Could not reach the app (${message}). Nothing was read or saved; do not retry in a loop.`;
      return { isError: true, content: [{ type: "text" as const, text }] };
    }
  };

  const see = "Collections and fields: see data_query.";
  server.registerTool(
    "data_get",
    { description: `Reads one record by its key (no key for a one-record collection). ${see}`, inputSchema: { collection: z.enum(names(visible)), key: key.optional() } },
    call("get"),
  );
  server.registerTool(
    "data_query",
    {
      description: `Lists records. \`where\` takes equality ({"state":"seen"}) or membership ({"id":{"in":["a","b"]}}) only; \`fields\` picks fields (the key always comes); \`limit\` defaults to 50, at most 200. The answer says the total. Collections:\n${catalogue(visible)}`,
      inputSchema: { collection: z.enum(names(visible)), where: fields.optional(), fields: z.array(z.string()).optional(), limit: z.number().int().min(1).max(200).optional() },
    },
    call("query"),
  );
  if (writable.length > 0) {
    const writeDoc = `Checked against the schema and rules; a refusal says why. Writable: ${writable.map(([n]) => n).join(", ")}. ${see}`;
    server.registerTool(
      "data_put",
      { description: `Creates a record, or replaces the one with the same key. ${writeDoc}`, inputSchema: { collection: z.enum(names(writable)), record: fields } },
      call("put"),
    );
    server.registerTool(
      "data_patch",
      { description: `Changes some fields of a record; its key can't change. ${writeDoc}`, inputSchema: { collection: z.enum(names(writable)), key: key.optional(), patch: fields } },
      call("patch"),
    );
    server.registerTool(
      "data_delete",
      { description: `Deletes a record. ${writeDoc}`, inputSchema: { collection: z.enum(names(writable)), key: key.optional() } },
      call("delete"),
    );
  }
  return server;
}
