import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { RpcRefused, callRpc } from "@humanharness/blocks";
import { z } from "zod";
import { FRAGMENT_ID } from "./fragment";
import { STAGE_TOOLS } from "./stages";

const ID = z.string().regex(FRAGMENT_ID);

/**
 * The `material` MCP server (§9, §10). Person mode: a task's `material_read`, `material_search`, `material_flag` and
 * `material_conflict`. System mode: `material_read` plus the stage's own tools. Every call goes to the
 * app over `rpc` as `{ op, ...args }`; a refusal comes back as a tool error. The server writes nothing itself: the app
 * process is the one owner of each scope's registry (`MaterialStore` serializes writes within one object only).
 */
export function createMaterialServer(rpc: { path: string; token: string }, mode: "person" | "system", tools: readonly string[]): McpServer {
  const server = new McpServer({ name: "material", version: "0.1.0" });
  const call = (op: string) => async (args: Record<string, unknown>) => {
    try {
      const result = await callRpc(rpc, { op, ...args }, 60_000);
      return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const text = e instanceof RpcRefused ? `Refused: ${message}` : `Could not reach the app (${message}). Do not retry in a loop.`;
      return { isError: true, content: [{ type: "text" as const, text }] };
    }
  };
  server.registerTool(
    "material_read",
    { description: "Reads one fragment of the person's material by its id (from the index or a search). Cite it as [[frag:<id>]].", inputSchema: { id: ID } },
    call("read"),
  );
  if (mode === "person") {
    server.registerTool(
      "material_search",
      { description: "Searches the person's material in this task's scope. Returns up to 8 fragments: id, where, path, summary.", inputSchema: { query: z.string().min(1).max(200) } },
      call("search"),
    );
    server.registerTool(
      "material_flag",
      { description: "Reports a fragment that reads wrong (garbled, cut, a broken table). It is checked again later.", inputSchema: { id: ID, reason: z.string().min(1).max(300) } },
      call("flag"),
    );
    server.registerTool(
      "material_conflict",
      {
        description: "Records that the material and your own knowledge disagree: the fragment, the claim, and how you resolved it (you follow the material).",
        inputSchema: { fragment: ID, claim: z.string().min(1).max(300), resolution: z.string().min(1).max(300) },
      },
      call("conflict"),
    );
  }
  if (mode === "system") {
    for (const name of tools) {
      if (!Object.hasOwn(STAGE_TOOLS, name)) continue;
      const t = STAGE_TOOLS[name];
      server.registerTool(name, { description: t.description, inputSchema: t.input }, call(name));
    }
  }
  return server;
}
