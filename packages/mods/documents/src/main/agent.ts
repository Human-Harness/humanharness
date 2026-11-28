// The agent's side of documents: the writing guide (with the harness's document kinds and the review rules) and the
// review tools. The app and `humanharness run` both build it here, so the agent gets the same text and tools in both.
import type { DocumentKind } from "@humanharness/harness-sdk";
import type { AgentTool } from "@humanharness/mod-sdk";
import type { CoreAgentInfo } from "@humanharness/mod-sdk/core";
import { ReviewRefused } from "@humanharness/workspace";

/** English whatever the person's language, as the whole managed section is (spec 5 D4). */
const TEXT = {
  writing: "### Writing for the reader",
  writingIntro: "The person reads the `.md` files you write in a reader with rich Markdown. Write them for that reader:",
  writingRules: (withKinds: boolean) => [
    "**Structure.** One idea per section. Use `##` for sections and `###` for subsections, and never skip a level. Keep paragraphs to two to four sentences.",
    "**Summary first.** A document longer than about 300 words starts with a `> [!SUMMARY]` callout that holds the conclusion.",
    "**Pick the element by the content:**",
    "  - two or more options compared on two or more criteria: a table;",
    "  - a flow, a sequence, states or components: a Mermaid diagram (a ```mermaid fence), followed by a one-line caption in italics;",
    "  - a decision: `> [!DECISION]`, with the reason;",
    "  - a question for the person: `> [!QUESTION]`;",
    "  - a risk: `> [!WARNING]`;",
    "  - pending steps: a task list (`- [ ]`).",
    "**Callouts.** Use only these six: `> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!SUMMARY]`, `> [!DECISION]`, `> [!QUESTION]`. The first line is the marker alone; the text follows on the next lines of the quote.",
    "**Limits.** Tables up to about six columns: split them, or use a list, beyond that. Diagrams up to about 15 nodes: split them beyond that.",
    "**No raw HTML.** It shows as text. Use Markdown only.",
    "**Links.** Link between documents with relative paths (`adr-007.md`, `../notes/x.md#context`). Links to the web use `https://`.",
    withKinds
      ? "**Front-matter.** Start every document with a front-matter block: `title` always, and `kind` when one of the kinds below fits."
      : "**Front-matter.** Start every document with a front-matter block holding `title` always.",
  ],
  reviewRules: [
    "**Asking about a passage.** Use `ask_in_document`, and give for each option the full text that replaces the passage.",
    "**Blocking questions.** Mark a question `blocking` only when the document can't be approved without its answer.",
    "**Review rounds.** After a review round, answer every comment with `reply_to_comment`.",
  ],
  writingExample: [
    "Example of the start of a document:",
    "",
    "    ---",
    "    title: Caching the search results",
    "    ---",
    "    > [!SUMMARY]",
    "    > Cache in memory for ten minutes; it removes most of the slow calls.",
    "",
    "    ## Context",
  ],
  kinds: "### Document kinds",
  kindsIntro:
    "When a document fits one of these kinds, put its id in the front-matter `kind` and use its `##` sections, in this order. Extra sections are fine. The reader warns the person when a section is missing.",
  kindTemplate: "Template:",
};

/** What `AGENTS.md` says about writing documents (document-reader spec §4.1, §4.2). */
export interface WritingGuide {
  /** The harness's document kinds; `{}` for the base guide only. */
  kinds: Record<string, DocumentKind>;
  /** The agent has the review tools (review spec §4): three more rules. Absent: none (D0). */
  review?: boolean;
}

/** The "Writing for the reader" part, and with kinds the "Document kinds" part. */
export function writingLines(writing: WritingGuide): string[] {
  const t = TEXT;
  const kinds = Object.entries(writing.kinds);
  const rules = t.writingRules(kinds.length > 0).map((r) => (r.startsWith("  ") ? r : `- ${r}`));
  if (writing.review) rules.push(...t.reviewRules.map((r) => `- ${r}`));
  const lines = ["", t.writing, "", t.writingIntro, "", ...rules, "", ...t.writingExample];
  if (kinds.length === 0) return lines;
  lines.push("", t.kinds, "", t.kindsIntro);
  for (const [id, k] of kinds) {
    // Six spaces: a code block inside the list item (content at column 2), so `## …` stays text.
    const code = "      ";
    lines.push("", `- \`${id}\`: ${k.when}`, `  ${t.kindTemplate}`, "", `${code}---`, `${code}title: …`, `${code}kind: ${id}`);
    if (k.status) lines.push(`${code}status: ${k.status.join(" | ")}`);
    lines.push(`${code}---`, ...k.sections.map((s) => `${code}## ${s}`));
  }
  return lines;
}

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
const REVIEW_TOOLS: readonly (Pick<AgentTool, "name" | "description" | "inputSchema"> & { op: "ask" | "reply" | "read" })[] = [
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
 * The documents mod's `instructions()` and `agentTools()`. Every harness gets the guide, with its document kinds when
 * it declares them (document-reader spec D4). The tools and the guide's review lines only for an agent that may edit
 * the folder (review spec §4, D0). `review` makes one tool call's request in the runtime's folder.
 */
export function documentsAgent(review: (folder: string, request: unknown) => Promise<unknown>): {
  instructions(info: CoreAgentInfo): string[];
  agentTools(info: CoreAgentInfo): AgentTool[];
} {
  return {
    instructions: (info) => writingLines({ kinds: info.documentKinds as Record<string, DocumentKind>, ...(info.canEdit ? { review: true } : {}) }),
    agentTools(info) {
      if (!info.canEdit) return [];
      const handle = reviewHandler((request) => review(info.folder, request));
      return REVIEW_TOOLS.map(({ op, ...definition }) => ({
        ...definition,
        tasksOnly: true,
        timeoutError: "The app did not answer; check with read_review before asking again",
        // `op` last: an argument named `op` never picks another request.
        handle: (args) => handle({ ...args, op }),
      }));
    },
  };
}
