import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type Collection, type LoadedHarness, loadHarness, z } from "@humanharness/harness-sdk";
import { RpcRefused, callRpc } from "./bridge";

/** The collections the agent may see (spec §4.1: everything but `agent: "none"`), in manifest order. */
export const agentCollections = (harness: Pick<LoadedHarness, "data">): [string, Collection][] =>
  Object.entries(harness.data).filter(([, c]) => c.agent !== "none");

/** The `data` MCP server starts only when there is something for the agent to see (D2). */
export const hasAgentData = (harness: Pick<LoadedHarness, "data">): boolean => agentCollections(harness).length > 0;

function fieldsOf(c: Collection): string {
  try {
    return JSON.stringify(z.toJSONSchema(c.schema));
  } catch {
    return Object.keys(c.schema.shape).join(", ");
  }
}

/** One line per collection: how it is keyed, where it lives, what the agent may do, and its fields. */
function catalogue(collections: [string, Collection][]): string {
  return collections
    .map(([name, c]) =>
      [
        `- ${name}:`,
        c.single ? "one record (no key)," : `key "${c.key}",`,
        c.scoped ? "in the task's scope," : "app-wide,",
        c.agent === "write" ? "read and write." : "read only.",
        `Fields: ${fieldsOf(c)}`,
      ].join(" "),
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

  const readDoc = `The harness's records. Collections:\n${catalogue(visible)}`;
  server.registerTool(
    "data_get",
    { description: `Reads one record by its key (no key for a one-record collection). ${readDoc}`, inputSchema: { collection: z.enum(names(visible)), key: key.optional() } },
    call("get"),
  );
  server.registerTool(
    "data_query",
    {
      description: `Lists records. \`where\` takes equality ({"state":"seen"}) or membership ({"id":{"in":["a","b"]}}) only; \`fields\` picks fields (the key always comes); \`limit\` defaults to 50, at most 200. The answer says the total. ${readDoc}`,
      inputSchema: { collection: z.enum(names(visible)), where: fields.optional(), fields: z.array(z.string()).optional(), limit: z.number().int().optional() },
    },
    call("query"),
  );
  if (writable.length > 0) {
    const writeDoc = `Every write is checked against the collection's schema and rules; a refusal says why. Collections you may change:\n${catalogue(writable)}`;
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
