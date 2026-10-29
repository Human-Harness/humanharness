import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  JOB_CANNOT_ASK,
  JOB_NO_NOTE,
  JOB_RESULT_TOOL,
  type LoadedHarness,
  STEP_OUTPUT_TOOL,
  aiOutputSchema,
  aiStepOf,
  allBlocks,
  blockToolName,
  jobResultSchema,
  loadHarness,
  phaseIds,
  z,
} from "@humanharness/harness-sdk";
import { RpcRefused, RpcTimeout, callRpc, sendToBridge } from "./bridge";

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

/**
 * What the agent reads when a review call fails: the app's own refusal, or a fixed line (never a socket path or another
 * error's text).
 */
export function reviewToolError(e: unknown): string {
  if (e instanceof RpcRefused) return e.message;
  if (e instanceof RpcTimeout) return "The app did not answer; check with read_review before asking again";
  return "Could not reach the app. Nothing was saved; do not retry in a loop.";
}

/** The review tools (review spec §4): each call is a request the app answers; a refusal comes back as a tool error. */
function addReviewTools(server: McpServer, rpc: { path: string; token: string }): void {
  const call = (op: "ask" | "reply" | "read") => async (args: Record<string, unknown>) => {
    try {
      // `op` last: an argument named `op` never picks another request.
      const result = await callRpc(rpc, { ...args, op });
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }] };
    } catch (e) {
      return { isError: true, content: [{ type: "text" as const, text: reviewToolError(e) }] };
    }
  };
  const str = z.string().max(50_000);
  // Loose shapes on purpose: the app checks and answers with the spec's messages ("options: 2 to 5").
  server.registerTool(
    "ask_in_document",
    {
      description: ASK_IN_DOCUMENT,
      inputSchema: {
        path: str,
        quote: str,
        heading: str.optional(),
        question: str,
        options: z.array(z.object({ label: str, text: str })),
        blocking: z.boolean().optional(),
      },
    },
    call("ask"),
  );
  server.registerTool(
    "reply_to_comment",
    { description: REPLY_TO_COMMENT, inputSchema: { path: str, id: str, reply: str, resolve: z.boolean() } },
    call("reply"),
  );
  server.registerTool("read_review", { description: READ_REVIEW, inputSchema: { path: str } }, call("read"));
}

/** The core blocks that ask the person or wait for them: a job refuses them (parallel spec §8, J1). Input blocks too. */
const JOB_REFUSED: readonly string[] = ["choices", "save_note", "set_phase", "recommend_mode"];

/**
 * MCP server with one tool per harness block. Valid calls are forwarded to the runtime through the bridge.
 * `job`: a background job's slot (`HH_JOB=1`): it adds `job_result` and refuses every block that asks the person.
 * `review`: the review channel: it also has the review tools (review spec §4), never in a job (they ask the person).
 * `step`: a recipe's AI step (`HH_STEP=<job>`, tools spec §7.1): `step_output` alone, nothing else (it wins over `job`).
 * Without any, exactly today's tools (D0).
 */
export async function createUiServer(
  harnessConfig: string,
  bridge: { path: string; token: string },
  opts: { job?: boolean; review?: { path: string; token: string }; step?: string } = {},
): Promise<McpServer> {
  const harness = await loadHarness(harnessConfig);
  if (opts.step !== undefined) return stepServer(harness, opts.step, bridge);
  const server = new McpServer({ name: "ui", version: "0.1.0" });
  const phases = phaseIds(harness);
  for (const [name, block] of Object.entries(allBlocks(harness))) {
    // Still a tool in a job, so the agent sees why it fails instead of guessing at a missing one. No input schema: the
    // refusal comes before any argument check, so bad arguments don't cost a turn on a schema error first.
    if (opts.job && (JOB_REFUSED.includes(name) || block.input)) {
      const text = name === "save_note" ? JOB_NO_NOTE : JOB_CANNOT_ASK;
      server.registerTool(blockToolName(name, block), { description: block.description }, async () => ({
        isError: true,
        content: [{ type: "text" as const, text }],
      }));
      continue;
    }
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
  if (opts.review && !opts.job) addReviewTools(server, opts.review);
  return server;
}

/**
 * A recipe's AI step (tools spec §7.1, R1): one tool, `step_output`, whose input schema is the job's AI step `output`.
 * No block, no review tool, no job_result: the model's only way out is its result. Throws (the server never starts)
 * when the job has no AI step or its output has no JSON Schema: a step with a half-made tool would fail later and less
 * clearly.
 */
export function stepServer(harness: LoadedHarness, job: string, bridge: { path: string; token: string }): McpServer {
  const j = harness.jobs && Object.hasOwn(harness.jobs, job) ? harness.jobs[job] : undefined;
  const step = j ? aiStepOf(j) : undefined;
  if (!step) throw new Error(`No AI step for job "${job}"`);
  // The manifest refuses such an output at load; the server checks again rather than trust that it ran (a date, a
  // transform: the MCP SDK would fail on it only when the engine lists the tools).
  if (aiOutputSchema(step) === null) throw new Error(`The AI step's output of job "${job}" can't be a tool's input: it must convert to JSON Schema`);
  const server = new McpServer({ name: "ui", version: "0.1.0" });
  server.registerTool(
    STEP_OUTPUT_TOOL,
    { description: "Ends this step with its result. Call it once, with the whole result.", inputSchema: step.output.shape },
    async (args) => {
      try {
        await sendToBridge(bridge, { name: STEP_OUTPUT_TOOL, data: args });
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: `Could not reach the app (${e instanceof Error ? e.message : String(e)}).` }] };
      }
      return { content: [{ type: "text" as const, text: "Done: the result is recorded. End your turn now." }] };
    },
  );
  return server;
}
