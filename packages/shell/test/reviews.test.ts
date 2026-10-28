import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { History, ReviewLocks, blobId, loadReview, runReviewRequest } from "@humanharness/workspace";
import { type ReviewDeps, type ReviewRound, ReviewService, RoundNotStarted } from "../src/main/reviews";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-review-svc-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const DOC = "specs/spec.md";
const TEXT = "---\ntitle: Filter\nkind: spec\n---\n## Scope\n\nFilter by size.\n\nThe size filter keeps.\n";

async function setup(over: Partial<ReviewDeps> = {}) {
  const base = fs.mkdtempSync(path.join(root, "f-"));
  fs.mkdirSync(path.join(base, "specs"));
  fs.writeFileSync(path.join(base, DOC), TEXT);
  const history = new History(base, `${base}.git`, [".harness/"], [".harness/reviews/"]);
  await history.init();
  await history.save("Start");
  const rounds: ReviewRound[] = [];
  const approved: unknown[] = [];
  const changed: string[] = [];
  let release!: () => void;
  const gate = { settled: Promise.resolve() as Promise<void> };
  const svc = new ReviewService({
    base: async () => base,
    history: async () => history,
    trailer: async () => ({ task: "t1", action: "ticket" }),
    openTask: async () => ({ id: "t1", scope: "main" }),
    busy: () => false,
    whenSettled: async (write) => {
      await gate.settled;
      return write();
    },
    blocked: () => null,
    round: async (r) => void rounds.push(r),
    approved: (a) => void approved.push(a),
    reviewTier: (kind) => (kind === "spec" ? "deep" : "standard"),
    changed: (p) => void changed.push(p),
    now: () => new Date("2026-10-28T10:00:00.000Z"),
    ...over,
  });
  // The agent asks two questions through the same service (its tools).
  const ask = (quote: string, blocking: boolean) =>
    svc.agent(base, {
      op: "ask",
      path: DOC,
      quote,
      question: `About ${quote}?`,
      options: [
        { label: "Keep", text: quote },
        { label: "Change", text: `${quote.slice(0, -1)} and colour.` },
      ],
      blocking,
    });
  const hold = () => {
    gate.settled = new Promise<void>((r) => (release = r));
    return () => release();
  };
  const read = () => fs.readFileSync(path.join(base, DOC), "utf8");
  // The version the window shows (the view's blob).
  const blob = () => blobId(fs.readFileSync(path.join(base, DOC)));
  return { svc, base, history, rounds, approved, changed, ask, hold, read, blob };
}

describe("answers (§5.1)", () => {
  it("swap the passage, commit 'Answer: …' with the open task's trailer, and change back", async () => {
    const t = await setup();
    await t.ask("Filter by size.", true);
    expect(await t.svc.answer(DOC, "c1", 1)).toEqual({ ok: true, applied: true });
    expect(t.read()).toContain("Filter by size and colour.");
    const [top] = await t.history.list();
    expect(top).toMatchObject({ message: "Answer: specs/spec.md · About Filter by size.?", task: "t1", action: "ticket" });
    expect((await t.history.readFileAt(top.sha, DOC)) ?? "").toContain("and colour.");
    expect(await t.svc.answer(DOC, "c1", null)).toEqual({ ok: true, applied: true });
    expect(t.read()).toBe(TEXT);
    expect(t.changed).toContain(DOC);
  });

  it("wait until no turn runs", async () => {
    const t = await setup();
    await t.ask("Filter by size.", false);
    const release = t.hold();
    const pending = t.svc.answer(DOC, "c1", 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(t.read()).toBe(TEXT);
    release();
    expect(await pending).toEqual({ ok: true, applied: true });
  });

  it("are locked once approved, and unlock when the file changes", async () => {
    const t = await setup();
    await t.ask("Filter by size.", false);
    expect(await t.svc.approve(DOC, t.blob())).toMatchObject({ ok: true });
    expect(await t.svc.answer(DOC, "c1", 1)).toEqual({ ok: false, reason: "locked" });
    fs.writeFileSync(path.join(t.base, DOC), `${TEXT}\nMore.\n`);
    expect(await t.svc.answer(DOC, "c1", 1)).toMatchObject({ ok: true });
  });

  it("refuse an unknown id, a bad pick, a document outside", async () => {
    const t = await setup();
    await t.ask("Filter by size.", false);
    expect(await t.svc.answer(DOC, "c9", 0)).toEqual({ ok: false, reason: "unknown" });
    expect(await t.svc.answer(DOC, "c1", 7)).toEqual({ ok: false, reason: "bad-input" });
    expect(await t.svc.answer("../x.md", "c1", 0)).toEqual({ ok: false, reason: "outside" });
  });
});

describe("comments and the batch (§5.2, §5.3)", () => {
  it("a selection becomes a draft; send builds the round, marks it sent, at the kind's tier", async () => {
    const t = await setup();
    await t.ask("Filter by size.", false);
    expect(await t.svc.comment(DOC, { selected: "The size  filter keeps.", heading: "scope", text: "No, by size and colour." })).toEqual({ ok: true, id: "c2" });
    expect(await t.svc.answer(DOC, "c1", { other: "Only in the session." })).toMatchObject({ ok: true, applied: false });
    expect(await t.svc.send(DOC)).toEqual({ ok: true, sent: 2, to: "open" });
    expect(t.rounds).toHaveLength(1);
    expect(t.rounds[0]).toMatchObject({ path: DOC, title: "Filter", task: "t1", scope: "main", tier: "deep" });
    expect(t.rounds[0].message).toContain('- c2 on "The size filter keeps." (## Scope): "No, by size and colour."');
    expect((await loadReview(t.base, DOC))?.comments.map((c) => c.state)).toEqual(["sent", "sent"]);
    expect(await t.svc.send(DOC)).toEqual({ ok: false, reason: "nothing-to-send" });
  });

  it("another spelling of the path is the same document, record and lock", async () => {
    const t = await setup();
    await t.ask("Filter by size.", false);
    expect(await t.svc.comment(`./specs//spec.md`, { selected: "The size filter keeps.", heading: "scope", text: "x" })).toEqual({ ok: true, id: "c2" });
    expect((await loadReview(t.base, DOC))?.comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(t.changed.at(-1)).toBe(DOC);
    expect(await t.svc.view("specs/../specs/spec.md")).toMatchObject({ ok: true, review: { path: DOC } });
  });

  it("a selection not in the document is refused; drafts can be edited and deleted", async () => {
    const t = await setup();
    expect(await t.svc.comment(DOC, { selected: "nowhere", heading: null, text: "x" })).toEqual({ ok: false, reason: "not-found" });
    await t.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
    expect(await t.svc.editDraft(DOC, "c1", "y")).toEqual({ ok: true });
    expect((await loadReview(t.base, DOC))?.comments[0].text).toBe("y");
    expect(await t.svc.editDraft(DOC, "c1", null)).toEqual({ ok: true });
    expect((await loadReview(t.base, DOC))?.comments).toEqual([]);
  });

  it("refuses while a turn runs; puts the items back when the round never started", async () => {
    const busy = await setup({ busy: () => true });
    await busy.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
    expect(await busy.svc.send(DOC)).toEqual({ ok: false, reason: "busy" });
    let refused = false;
    let back!: () => void;
    const putBack = new Promise<void>((r) => (back = r));
    const failing = await setup({
      round: async () => {
        refused = true;
        throw new RoundNotStarted(new Error("A turn is already running"));
      },
      // The record changes once more after the refusal: the items went back.
      changed: () => void (refused && back()),
    });
    await failing.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
    await failing.svc.send(DOC);
    await putBack;
    expect((await loadReview(failing.base, DOC))?.comments[0].state).toBe("draft");
  });

  it("a round that fails after it started leaves the items sent (no round twice)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const t = await setup({ round: () => Promise.reject(new Error("The agent crashed")) });
      await t.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
      expect(await t.svc.send(DOC)).toMatchObject({ ok: true, sent: 1 });
      await vi.waitFor(() => expect(logged).toHaveBeenCalledWith("The review round failed", expect.any(Error)));
      expect((await loadReview(t.base, DOC))?.comments[0].state).toBe("sent");
    } finally {
      logged.mockRestore();
    }
  });

  it("a selection whose source passes the record's limits is refused, and the record still loads", async () => {
    const t = await setup();
    await t.ask("Filter by size.", false);
    // Rendered "ab ab …" under 20,000 characters; its source, with the bold markers, is well over.
    const para = "**ab** ".repeat(5000).trimEnd();
    fs.writeFileSync(path.join(t.base, DOC), `${TEXT}\n${para}\n`);
    const selected = "ab ".repeat(5000).trimEnd();
    expect(await t.svc.comment(DOC, { selected, heading: "scope", text: "Too long." })).toEqual({ ok: false, reason: "bad-input" });
    expect((await loadReview(t.base, DOC))?.comments.map((c) => c.id)).toEqual(["c1"]);
  });

  it("nothing is written while writes are blocked", async () => {
    const t = await setup({ blocked: () => "restoring" });
    const input = { selected: "Filter by size.", heading: "scope", text: "x" };
    expect(await t.svc.comment(DOC, input)).toEqual({ ok: false, reason: "blocked" });
    expect(await t.svc.editDraft(DOC, "c1", "y")).toEqual({ ok: false, reason: "blocked" });
    expect(await t.svc.reopen(DOC, "c1")).toEqual({ ok: false, reason: "blocked" });
    expect(await t.svc.approve(DOC, t.blob())).toEqual({ ok: false, reason: "blocked" });
    expect(await loadReview(t.base, DOC)).toBeNull();
  });

  it("the person reopens a resolved comment", async () => {
    const t = await setup();
    await t.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
    // The agent sees a comment only once it is sent.
    await t.svc.send(DOC);
    await runReviewRequest({ base: t.base, locks: new ReviewLocks(), task: async () => null }, { op: "reply", path: DOC, id: "c1", reply: "Done.", resolve: true });
    expect(await t.svc.reopen(DOC, "c1")).toEqual({ ok: true });
    expect((await loadReview(t.base, DOC))?.comments[0].state).toBe("draft");
  });
});

describe("approval (§5.4)", () => {
  it("asks for a reason with a blocking question open, stores it, commits, and tells the task", async () => {
    const t = await setup();
    await t.ask("Filter by size.", true);
    expect(await t.svc.approve(DOC, t.blob())).toEqual({ ok: false, reason: "reason-required", count: 1 });
    expect(await t.svc.approve(DOC, t.blob(), { reason: "Decided on the call" })).toEqual({ ok: true });
    const r = await loadReview(t.base, DOC);
    expect(r?.approvals).toEqual([{ blob: expect.stringMatching(/^[0-9a-f]{40}$/), at: "2026-10-28T10:00:00.000Z", reason: "Decided on the call" }]);
    expect(t.approved).toEqual([{ path: DOC, task: "t1", reason: "Decided on the call" }]);
    expect(await t.svc.view(DOC)).toMatchObject({ ok: true, blob: t.blob(), summary: { status: "approved" } });
    expect((await t.history.list())[0].message).toBe("Approved: specs/spec.md");
  });

  it("with unsent items it asks first; discard drops them and approves", async () => {
    const t = await setup();
    await t.svc.comment(DOC, { selected: "Filter by size.", heading: "scope", text: "x" });
    expect(await t.svc.approve(DOC, t.blob())).toEqual({ ok: false, reason: "unsent", count: 1 });
    expect(await t.svc.approve(DOC, t.blob(), { discard: true })).toEqual({ ok: true });
    expect((await loadReview(t.base, DOC))?.comments).toEqual([]);
  });

  it("refuses a version the person didn't see, also when the file changes while it waits for the turn", async () => {
    const t = await setup();
    const seen = t.blob();
    fs.writeFileSync(path.join(t.base, DOC), `${TEXT}More.\n`);
    expect(await t.svc.approve(DOC, seen)).toEqual({ ok: false, reason: "changed" });
    const shown = t.blob();
    const release = t.hold();
    const pending = t.svc.approve(DOC, shown);
    // The agent rewrites the document during its turn.
    fs.writeFileSync(path.join(t.base, DOC), `${TEXT}Rewritten.\n`);
    release();
    expect(await pending).toEqual({ ok: false, reason: "changed" });
    expect(await loadReview(t.base, DOC)).toBeNull();
    expect(t.approved).toEqual([]);
    expect(await t.svc.approve(DOC, "not-a-blob")).toEqual({ ok: false, reason: "bad-input" });
  });

  it("stale after a change; the approved text comes from the history; approving again appends", async () => {
    const t = await setup();
    await t.svc.approve(DOC, t.blob());
    fs.writeFileSync(path.join(t.base, DOC), `${TEXT}More.\n`);
    expect(await t.svc.view(DOC)).toMatchObject({ ok: true, summary: { status: "stale" } });
    expect(await t.svc.approvedText(DOC)).toEqual({ ok: true, text: TEXT });
    await t.svc.approve(DOC, t.blob());
    expect((await loadReview(t.base, DOC))?.approvals).toHaveLength(2);
  });
});

describe("summaries", () => {
  it("one per path; null without a record or when the document can't be read", async () => {
    const t = await setup();
    await t.ask("Filter by size.", true);
    expect(await t.svc.summaries([DOC, "specs/none.md", "../x.md"])).toEqual([
      { status: "draft", questions: 1, blocking: 1, unsent: 0, comments: 1 },
      null,
      null,
    ]);
  });
});
