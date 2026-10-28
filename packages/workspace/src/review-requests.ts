import path from "node:path";
import {
  type Review,
  type ReviewComment,
  type ReviewOption,
  anchorAt,
  locate,
  nextCommentId,
  refusedShape,
  reviewSchema,
  reviewStatus,
  sections,
} from "@humanharness/harness-sdk";
import { type OwnReason, type ReviewLocks, ReviewRefused, blobId, canonicalDocumentPath, loadReview, newReview, readOwnDocument, saveReview } from "./reviews";

/** At most this many comments in one record. */
export const MAX_COMMENTS = 500;
const MAX_REPLIES = 200;

export interface ReviewContext {
  /** The person's folder (the active profile's). */
  base: string;
  locks: ReviewLocks;
  /** The open task and its scope: a new record's `task` (§3). */
  task(): Promise<{ id: string; scope: string } | null>;
  now?(): Date;
  /** A record changed: the window draws it again. */
  changed?(doc: string): void;
}

const name = (p: string) => path.posix.basename(p);
/** The spec's messages (§4): "spec.md is outside your folder", … */
export function documentProblem(doc: string, reason: OwnReason): ReviewRefused {
  const text =
    reason === "outside"
      ? `${name(doc)} is outside your folder`
      : reason === "not-markdown"
        ? `${name(doc)} is not a Markdown (.md) document`
        : reason === "too-large"
          ? `${name(doc)} is too large to review`
          : `${name(doc)} does not exist`;
  return new ReviewRefused(text, reason);
}
const text = (v: unknown, max: number): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

/** Saves only a record the next load accepts, so a tool never leaves a "broken" one behind. */
async function save(ctx: ReviewContext, review: Review): Promise<void> {
  if (!reviewSchema.safeParse(review).success) throw new ReviewRefused(`the review of ${name(review.path)} can't hold that`, "bad-input");
  await saveReview(ctx.base, review);
  ctx.changed?.(review.path);
}

/**
 * The agent's review tools (§4), run as the agent in the person's folder. Each refusal throws `ReviewRefused` with the
 * message the agent reads as a tool error; it may retry.
 */
export async function runReviewRequest(ctx: ReviewContext, request: unknown): Promise<unknown> {
  if (!request || typeof request !== "object") throw new ReviewRefused("Bad request");
  const r = request as Record<string, unknown>;
  if (typeof r.path !== "string" || refusedShape(r.path)) throw documentProblem(typeof r.path === "string" ? r.path : "document", "outside");
  // One key for the record, the lock and `path`, whatever spelling the agent used.
  const doc = await canonicalDocumentPath(ctx.base, r.path);
  if (doc === null) throw documentProblem(r.path, "outside");
  const at = () => (ctx.now?.() ?? new Date()).toISOString();
  if (r.op === "ask") return ask(ctx, doc, r, at);
  if (r.op === "reply") return reply(ctx, doc, r, at);
  if (r.op === "read") return read(ctx, doc);
  throw new ReviewRefused("Unknown request");
}

async function ask(ctx: ReviewContext, doc: string, r: Record<string, unknown>, at: () => string): Promise<{ id: string }> {
  if (!Array.isArray(r.options) || r.options.length < 2 || r.options.length > 5) throw new ReviewRefused("options: 2 to 5");
  const options: ReviewOption[] = r.options.map((o: unknown) => {
    const x = (o ?? {}) as { label?: unknown; text?: unknown };
    if (!text(x.label, 120) || typeof x.text !== "string" || x.text.length === 0 || x.text.length > 20_000)
      throw new ReviewRefused("options: each needs a `label` (up to 120 characters) and the `text` that replaces the passage");
    return { label: x.label.trim(), text: x.text };
  });
  if (!text(r.question, 500)) throw new ReviewRefused("question: 1 to 500 characters");
  if (typeof r.quote !== "string" || r.quote.length === 0 || r.quote.length > 20_000) throw new ReviewRefused(`quote not found in ${name(doc)}`, "not-found");
  if (r.heading !== undefined && !text(r.heading, 200)) throw new ReviewRefused("heading: a heading's slug, as in its link (#scope)");
  if (r.blocking !== undefined && typeof r.blocking !== "boolean") throw new ReviewRefused("blocking: true or false");
  const quote = r.quote;
  const heading = r.heading as string | undefined;
  const question = (r.question as string).trim();
  return ctx.locks.run(doc, async () => {
    const d = await readOwnDocument(ctx.base, doc);
    if (!d.ok) throw documentProblem(doc, d.reason);
    const found = anchorAt(d.text, quote, heading);
    if (!found.ok) throw new ReviewRefused(found.reason === "no-heading" ? `no heading #${heading} in ${name(doc)}` : `quote not found in ${name(doc)}`, "not-found");
    const review = (await loadReview(ctx.base, doc)) ?? newReview(doc, await ctx.task());
    if (review.comments.length >= MAX_COMMENTS) throw new ReviewRefused(`${name(doc)} has too many comments`, "full");
    const id = nextCommentId(review);
    const comment: ReviewComment = {
      id,
      author: "agent",
      kind: "question",
      anchor: found.anchor,
      text: question,
      options,
      ...(r.blocking === true ? { blocking: true } : {}),
      state: "open",
      replies: [],
      at: at(),
    };
    await save(ctx, { ...review, comments: [...review.comments, comment] });
    return { id };
  });
}

async function reply(ctx: ReviewContext, doc: string, r: Record<string, unknown>, at: () => string): Promise<{ id: string; state: string }> {
  const id = typeof r.id === "string" ? r.id : "";
  if (!text(r.reply, 4000)) throw new ReviewRefused("reply: 1 to 4000 characters");
  if (typeof r.resolve !== "boolean") throw new ReviewRefused("resolve: true when it is done, false when you ask something back");
  const words = (r.reply as string).trim();
  const resolve = r.resolve;
  return ctx.locks.run(doc, async () => {
    // Same folder rule as the other tools; a document deleted since may still have its comments answered.
    const d = await readOwnDocument(ctx.base, doc);
    if (!d.ok && d.reason !== "missing") throw documentProblem(doc, d.reason);
    const review = await loadReview(ctx.base, doc);
    const c = review?.comments.find((x) => x.id === id);
    if (!review || !c) throw new ReviewRefused(`unknown comment ${id || "(no id)"}`, "unknown");
    if (c.replies.length >= MAX_REPLIES) throw new ReviewRefused(`${id} has too many replies`, "full");
    // §4: resolve marks it resolved; a reply that asks something back keeps it open.
    const state = resolve ? ("resolved" as const) : ("open" as const);
    const next: ReviewComment = { ...c, state, replies: [...c.replies, { author: "agent", text: words, at: at() }] };
    await save(ctx, { ...review, comments: review.comments.map((x) => (x.id === id ? next : x)) });
    return { id, state };
  });
}

async function read(ctx: ReviewContext, doc: string): Promise<unknown> {
  const d = await readOwnDocument(ctx.base, doc);
  if (!d.ok) throw documentProblem(doc, d.reason);
  const review = await loadReview(ctx.base, doc);
  const secs = sections(d.text);
  const comments = (review?.comments ?? [])
    .filter((c) => c.state !== "resolved")
    .map((c) => ({
      id: c.id,
      author: c.author,
      kind: c.kind,
      quote: c.anchor.quote,
      heading: c.anchor.heading,
      text: c.text,
      ...(c.options ? { options: c.options } : {}),
      ...(c.blocking ? { blocking: true } : {}),
      ...(c.answer ? { answer: "option" in c.answer ? { option: c.answer.option, label: c.options?.[c.answer.option]?.label } : c.answer } : {}),
      // `lost` is computed from the text now, never written by a read (plan: Decisions, anchors).
      state: locate(d.text, c.anchor, { secs }) ? c.state : "lost",
      replies: c.replies,
    }));
  return { path: doc, status: reviewStatus(review, blobId(d.bytes)), comments };
}
