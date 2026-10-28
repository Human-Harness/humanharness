// zod for the review record (§3): main and the CLI only; the screens import `./review`, which has no zod.
import { z } from "zod";
import { isMarkdownPath, refusedShape } from "./documents";
import { MAX_OTHER } from "./review";

/** A comment id: `c1`, `c2`… (a short id: the only kind of text a regex here tests). */
export const COMMENT_ID = /^c[1-9][0-9]{0,5}$/;
const at = z.string().max(40);
const author = z.enum(["agent", "person"]);

const anchorSchema = z.strictObject({
  quote: z.string().min(1).max(20_000),
  heading: z.string().max(200).nullable(),
  occurrence: z.number().int().min(0).max(100_000),
});
export const reviewOptionSchema = z.strictObject({ label: z.string().min(1).max(120), text: z.string().min(1).max(20_000) });

const commentSchema = z
  .strictObject({
    id: z.string().regex(COMMENT_ID),
    author,
    kind: z.enum(["question", "comment"]),
    anchor: anchorSchema,
    text: z.string().min(1).max(4000),
    options: z.array(reviewOptionSchema).min(2).max(5).optional(),
    blocking: z.boolean().optional(),
    answer: z
      .union([z.strictObject({ option: z.number().int().min(0).max(4) }), z.strictObject({ other: z.string().min(1).max(MAX_OTHER) })])
      .optional(),
    original: z.string().max(20_000).optional(),
    unapplied: z.literal(true).optional(),
    state: z.enum(["draft", "open", "answered", "sent", "resolved", "lost"]),
    replies: z.array(z.strictObject({ author, text: z.string().min(1).max(4000), at })).max(200),
    at,
  })
  .superRefine((c, ctx) => {
    // Options and answers belong to the agent's questions; a picked option must be one of them.
    if (c.kind !== "question") {
      if (c.options !== undefined) ctx.addIssue({ code: "custom", path: ["options"], message: "Only a question has options" });
      if (c.answer !== undefined) ctx.addIssue({ code: "custom", path: ["answer"], message: "Only a question has an answer" });
    } else if (c.answer !== undefined && "option" in c.answer && c.answer.option >= (c.options?.length ?? 0)) {
      ctx.addIssue({ code: "custom", path: ["answer", "option"], message: "The answer is not one of the options" });
    }
  });

/**
 * A document's path as the store keys it: a plain relative Markdown path in one spelling, with no "", "." or ".."
 * part (so no leading, trailing or doubled slash). Case is the store's to fold.
 */
const canonicalPath = (p: string): boolean =>
  !refusedShape(p) && isMarkdownPath(p) && p.split("/").every((part) => part !== "" && part !== "." && part !== "..");

/** `.harness/reviews/<path>.json` (§3). A file that fails this is "broken" (a hand edit). */
export const reviewSchema = z
  .strictObject({
    path: z.string().min(1).max(1000).refine(canonicalPath, "Not a canonical Markdown path"),
    task: z.string().max(200).nullable(),
    scope: z.string().max(64).optional(),
    comments: z.array(commentSchema).max(500),
    approvals: z
      .array(z.strictObject({ blob: z.string().regex(/^[0-9a-f]{40}$/), at, reason: z.string().min(1).max(500).optional() }))
      .max(200),
  })
  .superRefine((r, ctx) => {
    // An id names one comment: replies, answers and the window's actions find it by id.
    const seen = new Set<string>();
    r.comments.forEach((c, i) => {
      if (seen.has(c.id)) ctx.addIssue({ code: "custom", path: ["comments", i, "id"], message: "Another comment has this id" });
      seen.add(c.id);
    });
  });
