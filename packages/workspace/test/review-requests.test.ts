import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { Review } from "@humanharness/harness-sdk";
import { MAX_RECORD_BYTES, ReviewLocks, loadReview, runReviewRequest, saveReview } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-revreq-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

function setup(task: { id: string; scope: string } | null = { id: "t1", scope: "main" }) {
  const base = fs.mkdtempSync(path.join(root, "f-"));
  fs.mkdirSync(path.join(base, "specs"));
  fs.writeFileSync(path.join(base, "specs", "spec.md"), "## Scope\n\nFilter by size.\n\n## Risks\n\nNone.\n");
  const changed: string[] = [];
  const ctx = { base, locks: new ReviewLocks(), task: async () => task, now: () => new Date("2026-10-28T10:00:00.000Z"), changed: (d: string) => changed.push(d) };
  return { base, ctx, changed };
}
const ask = (over: Record<string, unknown> = {}) => ({
  op: "ask",
  path: "specs/spec.md",
  quote: "Filter by size.",
  question: "Which filter?",
  options: [
    { label: "Size", text: "Filter by size." },
    { label: "Size and colour", text: "Filter by size and colour." },
  ],
  blocking: true,
  ...over,
});

describe("ask", () => {
  it("adds an open question anchored on the quote, in a new record for the open task", async () => {
    const { base, ctx, changed } = setup();
    expect(await runReviewRequest(ctx, ask())).toEqual({ id: "c1" });
    expect(await runReviewRequest(ctx, ask({ quote: "None.", heading: "risks", blocking: undefined }))).toEqual({ id: "c2" });
    const r = await loadReview(base, "specs/spec.md");
    expect(r).toMatchObject({ task: "t1", scope: "main" });
    expect(r?.comments[0]).toMatchObject({ author: "agent", kind: "question", state: "open", blocking: true, anchor: { quote: "Filter by size.", heading: "scope", occurrence: 0 } });
    expect(r?.comments[1].blocking).toBeUndefined();
    expect(changed).toEqual(["specs/spec.md", "specs/spec.md"]);
  });

  it.each([
    [{ quote: "nowhere" }, "quote not found in spec.md"],
    [{ quote: "None.", heading: "scope" }, "quote not found in spec.md"],
    [{ heading: "gone" }, "no heading #gone in spec.md"],
    [{ path: "../spec.md" }, "spec.md is outside your folder"],
    [{ path: ".harness/x.md" }, "x.md is outside your folder"],
    [{ path: "specs/none.md" }, "none.md does not exist"],
    [{ options: [{ label: "Only", text: "x" }] }, "options: 2 to 5"],
    [{ options: Array.from({ length: 6 }, (_, i) => ({ label: `${i}`, text: `${i}` })) }, "options: 2 to 5"],
  ])("refuses %j with %s", async (over, message) => {
    const { ctx } = setup();
    await expect(runReviewRequest(ctx, ask(over))).rejects.toThrow(message);
  });
});

describe("reply", () => {
  it("adds a reply, resolves or keeps it open, and refuses an unknown id", async () => {
    const { base, ctx } = setup();
    await runReviewRequest(ctx, ask());
    await runReviewRequest(ctx, { op: "reply", path: "specs/spec.md", id: "c1", reply: "Which colours?", resolve: false });
    expect((await loadReview(base, "specs/spec.md"))?.comments[0]).toMatchObject({ state: "open", replies: [{ author: "agent", text: "Which colours?" }] });
    await runReviewRequest(ctx, { op: "reply", path: "specs/spec.md", id: "c1", reply: "Done.", resolve: true });
    expect((await loadReview(base, "specs/spec.md"))?.comments[0].state).toBe("resolved");
    await expect(runReviewRequest(ctx, { op: "reply", path: "specs/spec.md", id: "c9", reply: "x", resolve: true })).rejects.toThrow("unknown comment c9");
  });
});

describe("read", () => {
  it("returns what is not resolved, lost passages, and the status", async () => {
    const { base, ctx } = setup(null);
    await runReviewRequest(ctx, ask());
    await runReviewRequest(ctx, ask({ quote: "None.", heading: "risks" }));
    await runReviewRequest(ctx, { op: "reply", path: "specs/spec.md", id: "c2", reply: "ok", resolve: true });
    fs.writeFileSync(path.join(base, "specs", "spec.md"), "## Scope\n\nRewritten.\n");
    const r = (await runReviewRequest(ctx, { op: "read", path: "specs/spec.md" })) as { status: string; comments: { id: string; state: string }[] };
    expect(r.status).toBe("draft");
    expect(r.comments).toEqual([expect.objectContaining({ id: "c1", state: "lost", quote: "Filter by size." })]);
    expect((await loadReview(base, "specs/spec.md"))?.task).toBeNull();
  });

  it("a document without a record has status none", async () => {
    const { ctx } = setup();
    expect(await runReviewRequest(ctx, { op: "read", path: "specs/spec.md" })).toEqual({ path: "specs/spec.md", status: "none", comments: [] });
  });
});

describe("guards", () => {
  it("reply refuses a path outside the folder", async () => {
    const { ctx } = setup();
    await expect(runReviewRequest(ctx, { op: "reply", path: "a/../.harness/x.md", id: "c1", reply: "x", resolve: true })).rejects.toThrow(
      "x.md is outside your folder",
    );
  });

  it("never saves a record the next load would call broken", async () => {
    const { base, ctx } = setup();
    fs.writeFileSync(path.join(base, "specs", "spec.md"), `## ${"long ".repeat(60)}\n\nFilter by size.\n`);
    await expect(runReviewRequest(ctx, ask())).rejects.toThrow("the heading above that passage in spec.md is too long to anchor on");
    expect(await loadReview(base, "specs/spec.md")).toBeNull();
  });
});

describe("one key per document", () => {
  it("every spelling of the path shares one record, one lock and one `path`", async () => {
    const { base, ctx, changed } = setup();
    expect(await runReviewRequest(ctx, ask({ path: "./specs/spec.md" }))).toEqual({ id: "c1" });
    expect(await runReviewRequest(ctx, ask({ path: "specs//spec.md" }))).toEqual({ id: "c2" });
    expect(await runReviewRequest(ctx, ask({ path: "x/../specs/spec.md" }))).toEqual({ id: "c3" });
    expect((await loadReview(base, "specs/spec.md"))?.path).toBe("specs/spec.md");
    expect(changed).toEqual(["specs/spec.md", "specs/spec.md", "specs/spec.md"]);
    expect(await runReviewRequest(ctx, { op: "read", path: "./specs/./spec.md" })).toMatchObject({ path: "specs/spec.md" });
  });

  it("refuses a question that would make the record too large, and the record still loads", async () => {
    const { base, ctx } = setup();
    const big = Array.from({ length: 5 }, (_, i) => ({ label: `${i}`, text: `${i}`.repeat(20_000) }));
    const seeded: Review = {
      path: "specs/spec.md",
      task: null,
      approvals: [],
      comments: Array.from({ length: 52 }, (_, i) => ({
        id: `c${i + 1}`,
        author: "agent" as const,
        kind: "question" as const,
        anchor: { quote: "Filter by size.", heading: "scope", occurrence: 0 },
        text: "Which?",
        options: big,
        state: "open" as const,
        replies: [],
        at: "2026-10-28T10:00:00.000Z",
      })),
    };
    await saveReview(base, seeded);
    await expect(runReviewRequest(ctx, ask({ options: big }))).rejects.toThrow("spec.md has too many comments");
    expect((await loadReview(base, "specs/spec.md"))?.comments).toHaveLength(52);
    // The person's side saves through the same function.
    const more = { ...seeded, comments: [...seeded.comments, { ...seeded.comments[0], id: "c53" }] };
    expect(JSON.stringify(more).length).toBeGreaterThan(MAX_RECORD_BYTES);
    await expect(saveReview(base, more)).rejects.toThrow("spec.md has too many comments");
  });

  it("takes a heading with its link's #", async () => {
    const { base, ctx } = setup();
    expect(await runReviewRequest(ctx, ask({ quote: "None.", heading: "#risks" }))).toEqual({ id: "c1" });
    expect((await loadReview(base, "specs/spec.md"))?.comments[0].anchor.heading).toBe("risks");
  });

  it("cuts an unknown id it echoes", async () => {
    const { ctx } = setup();
    const err = (await runReviewRequest(ctx, { op: "reply", path: "specs/spec.md", id: "x".repeat(5000), reply: "x", resolve: true }).catch((e: Error) => e)) as Error;
    expect(err.message.length).toBeLessThan(40);
    expect(err.message).toContain("unknown comment");
  });
});

describe("the person's drafts", () => {
  async function withDraft() {
    const s = setup();
    await runReviewRequest(s.ctx, ask());
    const r = (await loadReview(s.base, "specs/spec.md")) as Review;
    const draft = { id: "c2", author: "person" as const, kind: "comment" as const, anchor: { quote: "None.", heading: "risks", occurrence: 0 }, text: "Why none?", state: "draft" as const, replies: [], at: "2026-10-28T10:00:00.000Z" };
    await saveReview(s.base, { ...r, comments: [...r.comments, draft] });
    return s;
  }

  it("are left out of read", async () => {
    const { ctx } = await withDraft();
    const r = (await runReviewRequest(ctx, { op: "read", path: "specs/spec.md" })) as { comments: { id: string }[] };
    expect(r.comments.map((c) => c.id)).toEqual(["c1"]);
  });

  it("can't be answered: reply treats them as unknown", async () => {
    const { base, ctx } = await withDraft();
    await expect(runReviewRequest(ctx, { op: "reply", path: "specs/spec.md", id: "c2", reply: "x", resolve: true })).rejects.toThrow("unknown comment c2");
    expect((await loadReview(base, "specs/spec.md"))?.comments[1].state).toBe("draft");
  });
});
