import type { AgentToolDefinition, AgentToolSet } from "@humanharness/blocks";
import type { LoadedHarness } from "@humanharness/harness-sdk";
import { ReviewRefused, writingLines } from "@humanharness/workspace";

/** What the agent reads when a review request fails for a reason other than the app's own refusal. */
export const REVIEW_FAILED = "The app could not do that. Nothing was saved; do not retry in a loop.";

/**
 * The review tools' handler: the channel sends any thrown message to the agent, so only a `ReviewRefused` keeps its
 * text (written for the agent); any other error (a file system error naming paths) becomes `REVIEW_FAILED`.
 */
export function reviewHandler(handle: (request: unknown) => Promise<unknown>): (request: unknown) => Promise<unknown> {
  return async (request) => {
    try {
      return await handle(request);
    } catch (err) {
      if (err instanceof ReviewRefused) throw new Error(err.message);
      console.error("A review request failed", err);
      throw new Error(REVIEW_FAILED);
    }
  };
}

// Loose shapes on purpose: the app checks and answers with the spec's messages ("options: 2 to 5").
const str = { type: "string", maxLength: 50_000 };
const bool = { type: "boolean" };
const object = (properties: Record<string, unknown>, optional: readonly string[] = []) => ({
  type: "object",
  properties,
  required: Object.keys(properties).filter((name) => !optional.includes(name)),
});

/** The review tools (review spec §4) by the request each one makes. They ask the person: never in a job (J1). */
const REVIEW_TOOLS: readonly (AgentToolDefinition & { op: "ask" | "reply" | "read" })[] = [
  {
    op: "ask",
    name: "ask_in_document",
    description:
      "Asks the person about a passage of a Markdown document in their folder. `quote`: the passage's exact text; it must occur in the file (the first match is used, or the first under `heading`, a heading's slug such as `scope`). `options`: 2 to 5, each with a short `label` and the full `text` that replaces the passage when the person picks it; one option may keep the passage as it is. `blocking: true` only when the document can't be approved without an answer. The person answers in the reader; custom answers come in the next review round.",
    inputSchema: object(
      { path: str, quote: str, heading: str, question: str, options: { type: "array", items: object({ label: str, text: str }) }, blocking: bool },
      ["heading", "blocking"],
    ),
  },
  {
    op: "reply",
    name: "reply_to_comment",
    description:
      "Answers a review comment or question by its `id` (c1, c2…) after a review round. `resolve: true` when it is done; `false` when you ask something back.",
    inputSchema: object({ path: str, id: str, reply: str, resolve: bool }),
  },
  {
    op: "read",
    name: "read_review",
    description:
      "Reads a document's review: the comments and questions not resolved, their answers, and whether the document is approved, or changed since it was.",
    inputSchema: object({ path: str }),
  },
];

/**
 * The writing guide and the review tools, as the runtime's caller provides them. Every harness gets the guide, with its
 * document kinds when it declares them (document-reader spec D4). The tools and the guide's review lines only with a
 * handler and an agent that may edit the folder (review spec §4, D0).
 */
export function reviewAgent(harness: LoadedHarness, review?: (request: unknown) => Promise<unknown>): { instructions: () => string[][]; agentTools?: AgentToolSet } {
  const handle = review && harness.permissions.edit === "folder" ? reviewHandler(review) : undefined;
  const instructions = () => [writingLines({ kinds: harness.documents?.kinds ?? {}, ...(handle ? { review: true } : {}) })];
  if (!handle) return { instructions };
  return {
    instructions,
    agentTools: {
      definitions: REVIEW_TOOLS.map(({ op: _, ...definition }) => ({ ...definition, tasksOnly: true, timeoutError: "The app did not answer; check with read_review before asking again" })),
      // `op` last: an argument named `op` never picks another request.
      handle: async (tool, args) => handle({ ...args, op: REVIEW_TOOLS.find((t) => t.name === tool)?.op }),
    },
  };
}
