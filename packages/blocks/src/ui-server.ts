import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { allBlocks, blockToolName, loadHarness } from "@humanharness/harness-sdk";
import { sendToBridge } from "./bridge";

/** What the agent reads after showing a block the person answers (input-blocks spec §4): the answer is the next message. */
export const INPUT_DONE = "Done: the person can see it and will answer; wait for their answer.";

/** MCP server with one tool per harness block. Valid calls are forwarded to the runtime through the bridge. */
export async function createUiServer(harnessConfig: string, bridge: { path: string; token: string }): Promise<McpServer> {
  const harness = await loadHarness(harnessConfig);
  const server = new McpServer({ name: "ui", version: "0.1.0" });
  for (const [name, block] of Object.entries(allBlocks(harness))) {
    server.registerTool(
      blockToolName(name, block),
      { description: block.description, inputSchema: block.schema.shape },
      async (args) => {
        try {
          await sendToBridge(bridge, { name, data: args });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: `Could not reach the app (${message}). The person did not see this; do not retry in a loop.`,
              },
            ],
          };
        }
        // Only input blocks get the new text: every other block's answer stays as it was (spec D0).
        const text = block.input ? INPUT_DONE : block.visible ? "Done: the person can see it now." : "Done: state updated.";
        return { content: [{ type: "text" as const, text }] };
      },
    );
  }
  return server;
}
