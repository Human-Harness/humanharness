import type { ToolMeta } from "@humanharness/harness-sdk";
import { describe, expect, it } from "vitest";
import { type PreRowFields, prepareTask } from "../../src/main/tools/prepare-task";
import type { ToolAnswer, ToolCall } from "../../src/main/tools/tool-registry";

const meta: ToolMeta = { description: "A tool the runner calls in these tests", agent: "none", uses: {}, params: { type: "object", properties: {} }, timeout: 30, file: "tools/a.js" };

/** A registry double: answers by tool, records calls and notes in one ordered list. */
function registry(answers: Record<string, ToolAnswer>) {
  const seen: string[] = [];
  const notes: unknown[] = [];
  return {
    seen,
    notes,
    r: {
      call: async (c: ToolCall) => (seen.push(`call ${c.tool}`), answers[c.tool] ?? { ok: false as const, error: "no" }),
      meta: async () => meta,
      note: async (n: unknown) => void (seen.push("note"), notes.push(n)),
    },
  };
}

const O = { action: "study", scope: "intro", task: "t1" };

describe("prepareTask: the app's and the terminal's TaskDeps.prepare (end follow-up M13)", () => {
  it("runs the steps, then asks the descriptions, then writes the row; answers the section", async () => {
    const { r, seen } = registry({ a: { ok: true, result: { n: 1 } } });
    const rows: PreRowFields[] = [];
    const answer = await prepareTask(O, {
      registry: r,
      action: { pre: [{ tool: "a", as: "one" }] },
      scoped: true,
      descriptions: async () => (seen.push("descriptions"), { a: "The a tool" }),
      row: async (f) => void (seen.push("row"), rows.push(f)),
    });
    expect(seen).toEqual(["call a", "descriptions", "row"]);
    expect(answer.failed).toBeUndefined();
    expect(answer.text).toContain("### one · a\nThe a tool\n```json\n{\"n\":1}\n```");
    expect(answer.items).toHaveLength(1);
    expect(answer.views).toEqual([]);
    expect(rows).toEqual([{ action: "study", task: "t1", scope: "intro", steps: 1, ms: expect.any(Number), preparedTokens: expect.any(Number), ok: true }]);
    expect(rows[0]!.preparedTokens).toBeGreaterThan(0);
  });

  it("an unscoped harness's row names no scope; `around` wraps the steps; the caller's views come back", async () => {
    const { r } = registry({ a: { ok: true, result: 1 } });
    const rows: PreRowFields[] = [];
    const wrapped: string[] = [];
    const views: never[] = [];
    const answer = await prepareTask(O, {
      registry: r,
      action: { pre: [{ tool: "a" }] },
      scoped: false,
      around: async (run) => (wrapped.push("in"), run()),
      descriptions: async () => ({}),
      row: async (f) => void rows.push(f),
      views,
    });
    expect(wrapped).toEqual(["in"]);
    expect(rows[0]).not.toHaveProperty("scope");
    expect(answer.views).toBe(views);
  });

  it("a required step's failure answers `<tool> failed: <error>` and a row with no prepared tokens", async () => {
    const { r } = registry({ a: { ok: false, error: "it broke" } });
    const rows: PreRowFields[] = [];
    const answer = await prepareTask(O, {
      registry: r,
      action: { pre: [{ tool: "a", required: true }] },
      scoped: false,
      descriptions: async () => ({}),
      row: async (f) => void rows.push(f),
    });
    expect(answer).toEqual({ text: "", items: [], views: [], failed: "a failed: it broke" });
    expect(rows[0]).toMatchObject({ preparedTokens: 0, ok: false });
  });

  it("without an action: no step, an empty section, a row of 0 steps", async () => {
    const { r, seen } = registry({});
    const rows: PreRowFields[] = [];
    const answer = await prepareTask(O, { registry: r, action: undefined, scoped: false, descriptions: async () => ({}), row: async (f) => void rows.push(f) });
    expect(seen).toEqual([]);
    expect(answer).toEqual({ text: "", items: [], views: [] });
    expect(rows[0]).toMatchObject({ steps: 0, ok: true });
  });
});
