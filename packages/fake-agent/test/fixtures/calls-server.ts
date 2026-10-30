// Stub MCP server for tests: answers any tool, appends `{ server: HH_NAME, tool, args }` to HH_RECORD, and refuses the
// tool named in HH_REFUSE (isError, "No such thing: <tool>").
import { appendFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";

const server = new Server({ name: process.env.HH_NAME ?? "calls", version: "0.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
server.setRequestHandler(CallToolRequestSchema, async (req) => {
  appendFileSync(process.env.HH_RECORD!, JSON.stringify({ server: process.env.HH_NAME, tool: req.params.name, args: req.params.arguments }) + "\n");
  if (req.params.name === process.env.HH_REFUSE) return { isError: true, content: [{ type: "text", text: `No such thing: ${req.params.name}` }] };
  return { content: [{ type: "text", text: "Done." }] };
});
await server.connect(new StdioServerTransport());
