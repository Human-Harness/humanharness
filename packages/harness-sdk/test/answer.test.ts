import { describe, expect, it, vi } from "vitest";
import {
  ANSWER_MAX_CHARS,
  BLOCK_ID,
  answerDisplay,
  answerMessage,
  blockIdOf,
  defineBlock,
  isSkipped,
  parseAnswer,
  readAnswer,
  readableAnswer,
  z,
} from "../src";

const commit = defineBlock({
  description: "Commit.",
  visible: true,
  schema: z.object({ question: z.string(), options: z.array(z.string()).optional() }),
  input: z.object({ choice: z.string().optional(), why: z.string().min(1).max(1000) }),
  inputUi: { choice: { label: "I pick" }, why: { label: "Why" } },
  skippable: true,
  example: { question: "q" },
});
const all = defineBlock({
  description: "All kinds.",
  visible: true,
  schema: z.object({}),
  input: z.object({
    sure: z.boolean(),
    tags: z.array(z.enum(["a", "b"])),
    cards: z.array(z.object({ front: z.string(), back: z.string() })),
    count: z.number().optional(),
  }),
  example: {},
});

describe("block ids", () => {
  it("are task, turn and index", () => {
    expect(blockIdOf("3f6c-aa", 2, 1)).toBe("3f6c-aa:2:1");
    expect(BLOCK_ID.test("3f6c-aa:2:1")).toBe(true);
    expect(BLOCK_ID.test("t1:x:1")).toBe(false);
    expect(BLOCK_ID.test("../t:1:1")).toBe(false);
  });
});

describe("parseAnswer", () => {
  it("returns the parsed value, or the issues by field", () => {
    expect(parseAnswer(commit, { choice: "Yo", why: "porque", extra: 1 })).toEqual({ ok: true, value: { choice: "Yo", why: "porque" } });
    const bad = parseAnswer(commit, { why: "" });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.map((e) => e.path)).toEqual(["why"]);
  });

  it("takes { skipped: true } only from a skippable block", () => {
    expect(isSkipped({ skipped: true })).toBe(true);
    expect(isSkipped({ skipped: true, why: "x" })).toBe(false);
    expect(parseAnswer(commit, { skipped: true })).toEqual({ ok: true, value: { skipped: true } });
    expect(parseAnswer(all, { skipped: true }).ok).toBe(false);
  });

  it("refuses an answer too long to send", () => {
    const big = defineBlock({ description: "b", visible: true, schema: z.object({}), input: z.object({ text: z.string() }), example: {} });
    const r = parseAnswer(big, { text: "x".repeat(ANSWER_MAX_CHARS) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatchObject({ path: "" });
  });

  it("refuses a value JSON can't hold instead of throwing", () => {
    const loose = defineBlock({ description: "l", visible: true, schema: z.object({}), input: z.object({ meta: z.unknown() }), example: {} });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const r = parseAnswer(loose, { meta: cyclic });
    expect(r).toEqual({ ok: false, errors: [{ path: "", message: "The answer can't be sent as JSON" }] });
  });
});

describe("readableAnswer", () => {
  it("is one `label: value` paragraph per answered field, in English whatever the answer's language", () => {
    expect(readableAnswer(commit, { choice: "Las dos igual", why: "Porque 2 pedazos chiquitos son como uno grande" })).toBe(
      "I pick: Las dos igual\n\nWhy: Porque 2 pedazos chiquitos son como uno grande",
    );
    expect(readableAnswer(commit, { why: "because" })).toBe("Why: because");
  });

  it("reads booleans, multi-choices and pairs; a skipped or empty answer has its own words", () => {
    expect(readableAnswer(all, { sure: true, tags: ["a", "b"], cards: [{ front: "2+2", back: "4" }, { front: "3·3", back: "9" }] })).toBe(
      "Sure: yes\n\nTags: a, b\n\nCards: 2+2 → 4; 3·3 → 9",
    );
    expect(readableAnswer(commit, { skipped: true })).toBe("(skipped)");
    expect(readableAnswer(all, { sure: false, tags: [], cards: [] })).toBe("Sure: no");
    const empty = defineBlock({ description: "e", visible: true, schema: z.object({}), input: z.object({ note: z.string().optional() }), example: {} });
    expect(readableAnswer(empty, {})).toBe("(empty answer)");
  });
});

describe("answerDisplay", () => {
  it("uses the harness's display, on a copy, and falls back to the core line", () => {
    const seen: unknown[] = [];
    const own = defineBlock({
      ...commit,
      display: (value) => {
        seen.push(value);
        (value as { why: string }).why = "changed";
        return "  Me comprometo con: Yo  ";
      },
    });
    const value = { choice: "Yo", why: "x" };
    expect(answerDisplay("commit_answer", own, value, "es")).toBe("Me comprometo con: Yo");
    expect(value.why).toBe("x");
    const log = vi.fn();
    const throws = defineBlock({ ...commit, display: () => { throw new Error("boom"); } });
    expect(answerDisplay("commit_answer", throws, value, "es", log)).toBe("I pick: Yo\n\nWhy: x");
    expect(log).toHaveBeenCalledWith(expect.stringContaining("boom"));
    const blank = defineBlock({ ...commit, display: () => " " });
    expect(answerDisplay("commit_answer", blank, value, "es", log)).toBe("I pick: Yo\n\nWhy: x");
  });

  it("logs a slow display", () => {
    let now = 0;
    const slow = defineBlock({ ...commit, display: () => "ok" });
    const log = vi.fn();
    expect(answerDisplay("commit_answer", slow, { why: "x" }, "en", log, () => (now += 150))).toBe("ok");
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/display of "commit_answer" took 150 ms/));
  });
});

describe("the turn message", () => {
  it("holds the readable line and the exact JSON, and reads back", () => {
    const value = { choice: "Las dos igual", why: "Porque sí" };
    const message = answerMessage({ name: "commit_answer", blockId: "t1:0:0", value, display: "I pick: Las dos igual" });
    expect(message).toBe(
      '[answer to commit_answer]\nI pick: Las dos igual\n\n```json\n{"block":"commit_answer","blockId":"t1:0:0","value":{"choice":"Las dos igual","why":"Porque sí"}}\n```',
    );
    expect(answerMessage({ name: "x", blockId: "t1:0:0", value: {}, display: "d" }).startsWith("[answer to x]\nd")).toBe(true);
    expect(readAnswer(message)).toEqual({ block: "commit_answer", blockId: "t1:0:0", value });
  });

  it("reads nothing from a plain message or a broken fence", () => {
    expect(readAnswer("Contame más.")).toBeNull();
    expect(readAnswer("x\n\n```json\n{not json}\n```")).toBeNull();
    expect(readAnswer('x\n\n```json\n{"block":"a"}\n```')).toBeNull();
  });
});
