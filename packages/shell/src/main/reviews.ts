import { documentTitle, splitFrontMatter } from "@humanharness/harness-sdk/documents";
import {
  type AnswerPick,
  type Review,
  type ReviewComment,
  type ReviewSummary,
  type Tier,
  anchorForSelection,
  answerQuestion,
  batchMessage,
  cut,
  isUnsent,
  markSent,
  nextCommentId,
  refusedShape,
  summarizeReview,
} from "@humanharness/harness-sdk";
import type { ApprovedText, CommentInput, ReviewFailure, ReviewResult, ReviewSendResult, ReviewView } from "@humanharness/ui/client";
import {
  type HistoryTrailer,
  MAX_COMMENTS,
  ReviewLocks,
  ReviewRefused,
  blobId,
  canonicalDocumentPath,
  loadReview,
  newReview,
  readOwnDocument,
  runReviewRequest,
  saveReview,
  writeOwnDocument,
} from "@humanharness/workspace";

/** A review round for the task manager (§5.3). */
export interface ReviewRound {
  path: string;
  title: string;
  message: string;
  /** The record's task (null: none). */
  task: string | null;
  scope?: string;
  tier: Tier;
}

export interface ReviewDeps {
  /** The person's folder (the active profile's); null when the app isn't set up. */
  base(): Promise<string | null>;
  history(): Promise<{ save(message: string, trailer?: HistoryTrailer): Promise<string | null>; readBlob(oid: string): Promise<string | null> } | null>;
  /** The open task's trailer: an answer's and an approval's commits belong to it (undo, §7). */
  trailer(): Promise<HistoryTrailer | undefined>;
  openTask(): Promise<{ id: string; scope: string } | null>;
  /** A turn or a task operation runs now. */
  busy(): boolean;
  /** Resolves once no turn runs (§5.1 "writes during a turn"). */
  settled(): Promise<void>;
  /** Why writes can't run now (a restore, a folder move, quitting), or null. */
  blocked(): string | null;
  /** Starts the round (task manager); it may run a whole turn. */
  round(r: ReviewRound): Promise<unknown>;
  /** The approval is saved and committed (§5.4): the task manager's part. */
  approved(a: { path: string; task: string | null; reason?: string }): void;
  /** The tier of a "Review <title>" task for a document of `kind` (§11.3). */
  reviewTier(kind: string | undefined): Tier;
  /** A record changed: the window draws it again. */
  changed(path: string): void;
  now?(): Date;
}

/** At most this many paths per `summaries` call. */
export const MAX_SUMMARY_PATHS = 200;

type Doc = { base: string; doc: string; text: string; bytes: Buffer; review: Review | null };

const isPick = (p: unknown): p is AnswerPick =>
  p === null || (typeof p === "number" && Number.isInteger(p) && p >= 0 && p <= 4) || (typeof p === "object" && p !== null && typeof (p as { other?: unknown }).other === "string");

/** Drafts go; "Other" and unapplied answers go back to no answer (§5.4 "Discard and approve"). */
function discardUnsent(comments: ReviewComment[]): ReviewComment[] {
  return comments
    .filter((c) => c.state !== "draft")
    .map((c) => {
      if (!isUnsent(c)) return c;
      const { answer: _a, unapplied: _u, ...rest } = c;
      return { ...rest, state: "open" as const };
    });
}

/**
 * The person's side of document reviews (§5): answers, comments, rounds, approval. Every result is data. Every write
 * holds the document's lock (shared with the agent's tools); an answer or an approval first waits until no turn runs,
 * then commits on its own with the open task's trailer.
 */
export class ReviewService {
  private readonly locks = new ReviewLocks();

  constructor(private readonly d: ReviewDeps) {}

  private at(): string {
    return (this.d.now?.() ?? new Date()).toISOString();
  }

  /** The agent's tools (§4), in the folder its runtime runs in. Refusals throw: the rpc turns them into tool errors. */
  agent(base: string, request: unknown): Promise<unknown> {
    return runReviewRequest({ base, locks: this.locks, task: () => this.d.openTask(), changed: (p) => this.d.changed(p), ...(this.d.now ? { now: this.d.now } : {}) }, request);
  }

  /**
   * Reads the document and its record under its lock, then runs `fn`. The record, the lock and `doc` use the one
   * canonical key (`canonicalDocumentPath`), the agent's tools' too. Refusals and failures become data.
   */
  private async withDoc<T extends { ok: boolean }>(rel: unknown, fn: (x: Doc) => Promise<T | ReviewFailure>): Promise<T | ReviewFailure> {
    try {
      if (typeof rel !== "string" || refusedShape(rel)) return { ok: false, reason: "outside" };
      const base = await this.d.base();
      if (!base) return { ok: false, reason: "not-ready" };
      const doc = await canonicalDocumentPath(base, rel);
      if (doc === null) return { ok: false, reason: "outside" };
      return await this.locks.run(doc, async () => {
        const read = await readOwnDocument(base, doc);
        if (!read.ok) return { ok: false, reason: read.reason } as ReviewFailure;
        return fn({ base, doc: read.path, text: read.text, bytes: read.bytes, review: await loadReview(base, read.path) });
      });
    } catch (err) {
      // "full": a save past `MAX_RECORD_BYTES`.
      if (err instanceof ReviewRefused) return { ok: false, reason: err.reason };
      console.error("A review action failed", err);
      return { ok: false, reason: "not-ready" };
    }
  }

  private async commit(message: string): Promise<void> {
    const history = await this.d.history();
    await history?.save(message, await this.d.trailer());
  }

  view(rel: unknown): Promise<ReviewView> {
    return this.withDoc(rel, async ({ bytes, review }) => ({ ok: true as const, review, summary: summarizeReview(review, blobId(bytes)) }));
  }

  /** One summary per path (the chat's chips, harness views); null without a record or when it can't be read. */
  async summaries(paths: unknown): Promise<(ReviewSummary | null)[]> {
    if (!Array.isArray(paths)) return [];
    if (paths.length > MAX_SUMMARY_PATHS) return paths.map(() => null);
    return Promise.all(
      paths.map(async (p) => {
        const v = await this.view(p);
        return v.ok && v.review ? v.summary : null;
      }),
    );
  }

  /** An answer (§5.1): waits for the turn, swaps under the guard, commits `Answer: <path> · <question>`. */
  async answer(rel: unknown, id: unknown, pick: unknown): Promise<ReviewResult> {
    if (this.d.blocked()) return { ok: false, reason: "blocked" };
    if (typeof id !== "string" || !isPick(pick)) return { ok: false, reason: "bad-input" };
    await this.d.settled();
    return this.withDoc(rel, async ({ base, doc, text, bytes, review }) => {
      const c = review?.comments.find((x) => x.id === id);
      if (!review || !c) return { ok: false, reason: "unknown" };
      if (summarizeReview(review, blobId(bytes)).status === "approved") return { ok: false, reason: "locked" };
      const r = answerQuestion(text, c, pick);
      if (!r.ok) return { ok: false, reason: "bad-input" };
      if (r.text !== null && r.text !== text) {
        const w = await writeOwnDocument(base, doc, bytes, r.text);
        if (!w.ok) return { ok: false, reason: w.reason };
      }
      await saveReview(base, { ...review, comments: review.comments.map((x) => (x.id === c.id ? r.comment : x)) });
      await this.commit(`Answer: ${doc} · ${cut(c.text, 60)}`);
      this.d.changed(doc);
      return { ok: true, applied: r.text !== null };
    });
  }

  /** A comment on a rendered selection (§5.2): a draft. */
  comment(rel: unknown, input: unknown): Promise<ReviewResult> {
    const i = (input ?? {}) as Partial<CommentInput>;
    if (typeof i.selected !== "string" || i.selected.length > 20_000 || (i.heading !== null && typeof i.heading !== "string") || typeof i.text !== "string" || !i.text.trim() || i.text.length > 4000)
      return Promise.resolve({ ok: false, reason: "bad-input" });
    const { selected, heading, text: words } = i as CommentInput;
    return this.withDoc(rel, async ({ base, doc, text, review }) => {
      const anchor = anchorForSelection(text, selected, heading);
      if (!anchor) return { ok: false, reason: "not-found" };
      const r = review ?? newReview(doc, await this.d.openTask());
      if (r.comments.length >= MAX_COMMENTS) return { ok: false, reason: "full" };
      const id = nextCommentId(r);
      const comment: ReviewComment = { id, author: "person", kind: "comment", anchor, text: words.trim(), state: "draft", replies: [], at: this.at() };
      await saveReview(base, { ...r, comments: [...r.comments, comment] });
      this.d.changed(doc);
      return { ok: true, id };
    });
  }

  /** Edits a draft, or deletes it with null. Only the person's drafts. */
  editDraft(rel: unknown, id: unknown, text: unknown): Promise<ReviewResult> {
    if (typeof id !== "string" || (text !== null && (typeof text !== "string" || !text.trim() || text.length > 4000))) return Promise.resolve({ ok: false, reason: "bad-input" });
    return this.withDoc(rel, async ({ base, doc, review }) => {
      const c = review?.comments.find((x) => x.id === id);
      if (!review || !c || c.author !== "person" || c.state !== "draft") return { ok: false, reason: "unknown" };
      const comments = text === null ? review.comments.filter((x) => x.id !== id) : review.comments.map((x) => (x.id === id ? { ...x, text: (text as string).trim() } : x));
      await saveReview(base, { ...review, comments });
      this.d.changed(doc);
      return { ok: true };
    });
  }

  /** The person reopens a resolved comment (§11.2): a comment goes back to draft (the next round carries it), a question to open. */
  reopen(rel: unknown, id: unknown): Promise<ReviewResult> {
    return this.withDoc(rel, async ({ base, doc, review }) => {
      const c = review?.comments.find((x) => x.id === id);
      if (!review || !c || c.state !== "resolved") return { ok: false, reason: "unknown" };
      const state = c.kind === "comment" ? ("draft" as const) : c.answer ? ("answered" as const) : ("open" as const);
      await saveReview(base, { ...review, comments: review.comments.map((x) => (x.id === c.id ? { ...x, state } : x)) });
      this.d.changed(doc);
      return { ok: true };
    });
  }

  /** "Send comments (N)" (§5.3): marks the items sent, then starts the round; when it can't start, they go back. */
  async send(rel: unknown): Promise<ReviewSendResult> {
    if (this.d.blocked()) return { ok: false, reason: "blocked" };
    if (this.d.busy()) return { ok: false, reason: "busy" };
    const prepared = await this.withDoc(rel, async ({ base, doc, text, review }) => {
      const b = review ? batchMessage(doc, review, text) : null;
      if (!review || !b) return { ok: false, reason: "nothing-to-send" } as ReviewFailure;
      await saveReview(base, markSent(review, b.ids));
      this.d.changed(doc);
      const kind = splitFrontMatter(text).data.kind?.trim();
      const round: ReviewRound = {
        path: doc,
        title: documentTitle(doc, text),
        message: b.message,
        task: review.task,
        ...(review.scope ? { scope: review.scope } : {}),
        tier: this.d.reviewTier(kind),
      };
      return { ok: true as const, ids: b.ids, before: review, round };
    });
    if (!prepared.ok) return prepared;
    const { ids, before, round } = prepared;
    const to = (await this.d.openTask()) ? ("open" as const) : ("new" as const);
    void this.d.round(round).catch(async (err: unknown) => {
      console.error("The review round could not start", err);
      await this.unsend(round.path, ids, before);
    });
    return { ok: true, sent: ids.length, to };
  }

  /** The round never started: its items go back to what they were. */
  private async unsend(doc: string, ids: string[], before: Review): Promise<void> {
    await this.withDoc(doc, async ({ base, review }) => {
      if (!review) return { ok: true as const };
      const was = new Map(before.comments.map((c) => [c.id, c.state]));
      const comments = review.comments.map((c) => (ids.includes(c.id) && c.state === "sent" ? { ...c, state: was.get(c.id) ?? c.state } : c));
      await saveReview(base, { ...review, comments });
      this.d.changed(doc);
      return { ok: true as const };
    });
  }

  /**
   * "Approve" (§5.4): appends `{ blob, at, reason? }`, commits `Approved: <path>`, tells the task manager. The version
   * already approved changes nothing and tells no one.
   */
  async approve(rel: unknown, opts: unknown = {}): Promise<ReviewResult> {
    if (this.d.blocked()) return { ok: false, reason: "blocked" };
    const o = (opts ?? {}) as { reason?: unknown; discard?: unknown };
    if (o.reason !== undefined && (typeof o.reason !== "string" || o.reason.length > 500)) return { ok: false, reason: "bad-input" };
    const reason = typeof o.reason === "string" && o.reason.trim() ? o.reason.trim().split("\n").join(" ") : undefined;
    await this.d.settled();
    const r = await this.withDoc(rel, async ({ base, doc, bytes, review }) => {
      const record = review ?? newReview(doc, await this.d.openTask());
      const blob = blobId(bytes);
      if (summarizeReview(record, blob).status === "approved") return { ok: true as const, told: null };
      const unsent = record.comments.filter(isUnsent).length;
      if (unsent > 0 && o.discard !== true) return { ok: false, reason: "unsent", count: unsent } as ReviewFailure;
      const comments = o.discard === true ? discardUnsent(record.comments) : record.comments;
      const blocking = summarizeReview({ ...record, comments }, blob).blocking;
      if (blocking > 0 && !reason) return { ok: false, reason: "reason-required", count: blocking } as ReviewFailure;
      const approval = { blob, at: this.at(), ...(reason ? { reason } : {}) };
      await saveReview(base, { ...record, comments, approvals: [...record.approvals, approval].slice(-200) });
      await this.commit(`Approved: ${doc}`);
      this.d.changed(doc);
      return { ok: true as const, told: { path: doc, task: record.task, ...(reason ? { reason } : {}) } };
    });
    if (!r.ok) return r;
    if (r.told) this.d.approved(r.told);
    return { ok: true };
  }

  /** The last approved version's text (§5.4 "See what changed"), read from the history by its blob id. */
  approvedText(rel: unknown): Promise<ApprovedText> {
    return this.withDoc(rel, async ({ review }) => {
      const blob = review?.approvals.at(-1)?.blob;
      const history = blob ? await this.d.history() : null;
      const text = blob && history ? await history.readBlob(blob) : null;
      return text === null ? { ok: false, reason: "missing" } : { ok: true as const, text };
    });
  }
}
