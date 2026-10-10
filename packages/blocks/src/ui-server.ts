import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { blockToolName, loadHarness } from "@humanharness/harness-sdk";
import { sendToBridge } from "./bridge";

/** MCP server with one tool per harness block. Valid calls are forwarded to the runtime through the bridge. */
export async function createUiServer(harnessConfig: string, bridgePath: string): Promise<McpServer> {
  const harness = await loadHarness(harnessConfig);
  const server = new McpServer({ name: "ui", version: "0.1.0" });
  for (const [name, block] of Object.entries(harness.blocks)) {
    server.registerTool(
      blockToolName(name, block),
      { description: block.description, inputSchema: block.schema.shape },
      async (args) => {
        await sendToBridge(bridgePath, { name, data: args });
        const text = block.visible ? "Done: the person can see it now." : "Done: state updated.";
        return { content: [{ type: "text" as const, text }] };
      },
    );
  }
  return server;
}
