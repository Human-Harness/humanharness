// Stub MCP server for tests: offers `save_translation` and appends each call's arguments to HH_RECORD.
import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: "record", version: "0.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{ name: "save_translation", inputSchema: { type: "object" } }],
}));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  appendFileSync(process.env.HH_RECORD!, JSON.stringify({ tool: req.params.name, args: req.params.arguments }) + "\n");
  return { content: [{ type: "text", text: "Saved." }] };
});
await server.connect(new StdioServerTransport());
