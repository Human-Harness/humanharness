import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { allBlocks, blockToolName, loadHarness, phaseIds, z } from "@humanharness/harness-sdk";
import { RpcRefused, callRpc, sendToBridge } from "./bridge";

/** What the agent reads after showing a block the person answers (input-blocks spec §4): the answer is the next message. */
export const INPUT_DONE = "Done: the person can see it and will answer; wait for their answer.";

/** What the agent reads when `set_phase` names no part of this harness (task-phases spec §4.1). */
export const unknownPhase = (ids: readonly string[]): string => `Unknown part. Use one of: ${ids.join(", ")}.`;

export const ASK_IN_DOCUMENT =
  "Asks the person about a passage of a Markdown document in their folder. `quote`: the passage's exact text; it must occur in the file (the first match is used, or the first under `heading`, a heading's slug such as `scope`). `options`: 2 to 5, each with a short `label` and the full `text` that replaces the passage when the person picks it; one option may keep the passage as it is. `blocking: true` only when the document can't be approved without an answer. The person answers in the reader; custom answers come in the next review round.";
export const REPLY_TO_COMMENT =
  "Answers a review comment or question by its `id` (c1, c2…) after a review round. `resolve: true` when it is done; `false` when you ask something back.";
export const READ_REVIEW =
  "Reads a document's review: the comments and questions not resolved, their answers, and whether the document is approved, or changed since it was.";

/** The review tools (review spec §4): each call is a request the app answers; a refusal comes back as a tool error. */
function addReviewTools(server: McpServer, rpc: { path: string; token: string }): void {
  const call = (op: "ask" | "reply" | "read") => async (args: Record<string, unknown>) => {
    try {
      const result = await callRpc(rpc, { op, ...args });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const text = e instanceof RpcRefused ? message : `Could not reach the app (${message}). Nothing was saved; do not retry in a loop.`;
      return { isError: true, content: [{ type: "text" as const, text }] };
    }
  };
  // Loose shapes on purpose: the app checks and answers with the spec's messages ("options: 2 to 5").
  server.registerTool(
    "ask_in_document",
    {
      description: ASK_IN_DOCUMENT,
      inputSchema: {
        path: z.string(),
        quote: z.string(),
        heading: z.string().optional(),
        question: z.string(),
        options: z.array(z.object({ label: z.string(), text: z.string() })),
        blocking: z.boolean().optional(),
      },
    },
    call("ask"),
  );
  server.registerTool(
    "reply_to_comment",
    { description: REPLY_TO_COMMENT, inputSchema: { path: z.string(), id: z.string(), reply: z.string(), resolve: z.boolean() } },
    call("reply"),
  );
  server.registerTool("read_review", { description: READ_REVIEW, inputSchema: { path: z.string() } }, call("read"));
}

/**
 * MCP server with one tool per harness block. Valid calls are forwarded to the runtime through the bridge.
 * With a `review` channel it also has the review tools (review spec §4); without one its tools are unchanged (D0).
 */
export async function createUiServer(
  harnessConfig: string,
  bridge: { path: string; token: string },
  review?: { path: string; token: string },
): Promise<McpServer> {
  const harness = await loadHarness(harnessConfig);
  const server = new McpServer({ name: "ui", version: "0.1.0" });
  const phases = phaseIds(harness);
  for (const [name, block] of Object.entries(allBlocks(harness))) {
    server.registerTool(
      blockToolName(name, block),
      { description: block.description, inputSchema: block.schema.shape },
      async (args) => {
        // The server knows the harness, not the open task: an id of another action reaches the app, which ignores it.
        if (name === "set_phase" && !phases.includes(String((args as { to?: unknown }).to))) {
          return { isError: true, content: [{ type: "text" as const, text: unknownPhase(phases) }] };
        }
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
  if (review) addReviewTools(server, review);
  return server;
}
