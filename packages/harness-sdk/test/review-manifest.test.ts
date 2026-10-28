import { describe, expect, it } from "vitest";
import { type HarnessInput, RESERVED_BLOCK_NAMES, defineBlock, defineHarness, reviewSchema, z } from "../src";

const base: HarnessInput = {
  id: "dev",
  name: "Dev",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Dev" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  author: "t",
};
const withPhases = (phases: unknown[]): HarnessInput =>
  ({ ...base, actions: { ticket: { label: "Ticket", prompt: "tasks/ticket.md", cost: "medium", phases } } }) as HarnessInput;

describe("approve on a phase", () => {
  it("takes a valid glob", () => {
    expect(() => defineHarness(withPhases([{ id: "spec", label: "Spec", approve: "tickets/*/spec.md" }, { id: "plan", label: "Plan" }]))).not.toThrow();
    expect(() => defineHarness(withPhases([{ id: "spec", label: "Spec", approve: "**/*.md" }]))).not.toThrow();
  });

  it.each(["../x.md", "/x.md", "x.txt", "tickets/[a]/x.md", ".harness/x.md", "a/**b/x.md", `${"a/".repeat(100)}x.md`, ""])("refuses %s", (approve) => {
    expect(() => defineHarness(withPhases([{ id: "spec", label: "Spec", approve }]))).toThrow();
  });
});

describe("reviewTier on a kind", () => {
  const kinds = (reviewTier: unknown) => ({ ...base, documents: { kinds: { spec: { when: "A spec", sections: ["Scope"], reviewTier } } } }) as HarnessInput;
  it("takes a tier and refuses anything else", () => {
    expect(() => defineHarness(kinds("deep"))).not.toThrow();
    expect(() => defineHarness(kinds(undefined))).not.toThrow();
    expect(() => defineHarness(kinds("huge"))).toThrow();
  });
});

describe("reserved names", () => {
  it("no harness block may be called like a review tool", () => {
    expect(RESERVED_BLOCK_NAMES).toEqual(expect.arrayContaining(["ask_in_document", "reply_to_comment", "read_review"]));
    expect(() => defineHarness({ ...base, blocks: { read_review: defineBlock({ description: "x", schema: z.object({}), example: {}, visible: false }) } })).toThrow(/core block name/);
  });

  it("no harness block may take a review tool's name as its tool", () => {
    const block = defineBlock({ description: "x", tool: "ask_in_document", schema: z.object({}), example: {}, visible: false });
    expect(() => defineHarness({ ...base, blocks: { mine: block } })).toThrow(/ask_in_document/);
  });
});

describe("reviewSchema", () => {
  const question = {
    id: "c1",
    author: "agent",
    kind: "question",
    anchor: { quote: "x", heading: null, occurrence: 0 },
    text: "Which?",
    options: [
      { label: "A", text: "x" },
      { label: "B", text: "y" },
    ],
    state: "open",
    replies: [],
    at: "2026-10-28T10:00:00.000Z",
  };
  const comment = {
    id: "c2",
    author: "person",
    kind: "comment",
    anchor: { quote: "x", heading: null, occurrence: 0 },
    text: "Shorter",
    state: "draft",
    replies: [],
    at: "2026-10-28T10:00:00.000Z",
  };
  const ok = {
    path: "specs/a.md",
    task: null,
    comments: [question, comment],
    approvals: [{ blob: "a".repeat(40), at: "2026-10-28T10:00:00.000Z" }],
  };
  const withComment = (c: object) => ({ ...ok, comments: [c] });

  it("takes a valid record and refuses a broken one", () => {
    expect(reviewSchema.safeParse(ok).success).toBe(true);
    expect(reviewSchema.safeParse({ ...ok, approvals: [{ blob: "nope", at: "t" }] }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...ok, comments: [{ ...question, id: "x1" }] }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...ok, extra: 1 }).success).toBe(false);
  });

  it("keeps comment ids to c<n>", () => {
    for (const id of ["c0", "c01", "C1", "c1 ", "c1234567", ""]) expect(reviewSchema.safeParse(withComment({ ...question, id })).success).toBe(false);
    expect(reviewSchema.safeParse(withComment({ ...question, id: "c123456" })).success).toBe(true);
  });

  it("takes an answer only within the question's options", () => {
    expect(reviewSchema.safeParse(withComment({ ...question, answer: { option: 1 }, state: "answered" })).success).toBe(true);
    expect(reviewSchema.safeParse(withComment({ ...question, answer: { option: 2 }, state: "answered" })).success).toBe(false);
    expect(reviewSchema.safeParse(withComment({ ...question, answer: { other: "z" }, state: "answered" })).success).toBe(true);
    const { options: _, ...open } = question;
    expect(reviewSchema.safeParse(withComment({ ...open, answer: { option: 0 } })).success).toBe(false);
    expect(reviewSchema.safeParse(withComment(open)).success).toBe(true);
  });

  it("refuses two comments with one id", () => {
    expect(reviewSchema.safeParse({ ...ok, comments: [question, { ...comment, id: "c1" }] }).success).toBe(false);
  });

  it("takes only a canonical Markdown path", () => {
    for (const path of ["specs/a.md", "a.MD", "x y/b c.md"]) expect(reviewSchema.safeParse({ ...ok, path }).success).toBe(true);
    for (const path of ["", "specs/a.txt", "/specs/a.md", "./specs/a.md", "specs//a.md", "specs/./a.md", "x/../specs/a.md", "../a.md", "specs/a.md/", "specs\\a.md", "C:/a.md"])
      expect(reviewSchema.safeParse({ ...ok, path }).success, path).toBe(false);
  });

  it("refuses options or an answer on a comment", () => {
    expect(reviewSchema.safeParse(withComment({ ...comment, options: question.options })).success).toBe(false);
    expect(reviewSchema.safeParse(withComment({ ...comment, answer: { other: "z" } })).success).toBe(false);
  });
});
