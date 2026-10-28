import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  JOB_CANNOT_ASK,
  JOB_NO_NOTE,
  JOB_RESULT_TOOL,
  allBlocks,
  blockToolName,
  jobResultSchema,
  loadHarness,
  phaseIds,
} from "@humanharness/harness-sdk";
import { sendToBridge } from "./bridge";

/** What the agent reads after showing a block the person answers (input-blocks spec §4): the answer is the next message. */
export const INPUT_DONE = "Done: the person can see it and will answer; wait for their answer.";

/** What the agent reads when `set_phase` names no part of this harness (task-phases spec §4.1). */
export const unknownPhase = (ids: readonly string[]): string => `Unknown part. Use one of: ${ids.join(", ")}.`;

/** The core blocks that ask the person or wait for them: a job refuses them (parallel spec §8, J1). Input blocks too. */
const JOB_REFUSED: readonly string[] = ["choices", "save_note", "set_phase", "recommend_mode"];

/**
 * MCP server with one tool per harness block. Valid calls are forwarded to the runtime through the bridge.
 * `job`: a background job's slot (`HH_JOB=1`): it adds `job_result` and refuses every block that asks the person.
 * Without it, exactly today's tools (D0).
 */
export async function createUiServer(
  harnessConfig: string,
  bridge: { path: string; token: string },
  opts: { job?: boolean } = {},
): Promise<McpServer> {
  const harness = await loadHarness(harnessConfig);
  const server = new McpServer({ name: "ui", version: "0.1.0" });
  const phases = phaseIds(harness);
  for (const [name, block] of Object.entries(allBlocks(harness))) {
    server.registerTool(
      blockToolName(name, block),
      { description: block.description, inputSchema: block.schema.shape },
      async (args) => {
        // Still a tool in a job, so the agent sees why it fails instead of guessing at a missing one.
        if (opts.job && (JOB_REFUSED.includes(name) || block.input)) {
          return { isError: true, content: [{ type: "text" as const, text: name === "save_note" ? JOB_NO_NOTE : JOB_CANNOT_ASK }] };
        }
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
  if (opts.job) {
    server.registerTool(
      JOB_RESULT_TOOL,
      {
        description:
          "Ends this background job with its result: `status` ok, needs-you (name in `action` the action the person should start) or failed, and a one-line `summary`.",
        inputSchema: jobResultSchema.shape,
      },
      async (args) => {
        try {
          await sendToBridge(bridge, { name: JOB_RESULT_TOOL, data: args });
        } catch (e) {
          return { isError: true, content: [{ type: "text" as const, text: `Could not reach the app (${e instanceof Error ? e.message : String(e)}).` }] };
        }
        return { content: [{ type: "text" as const, text: "Done: the result is recorded. End your turn now." }] };
      },
    );
  }
  return server;
}
