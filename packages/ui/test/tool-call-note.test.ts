import { describe, expect, it } from "vitest";
import { cleanToolCalls } from "../src/tools/ToolCallLine";

const saved = (extra: Record<string, unknown> = {}) => ({
  tool: "due-today",
  caller: "pre",
  ok: true,
  ms: 0,
  summary: "",
  args: "null",
  accesses: [],
  at: "2026-10-29T10:00:00.000Z",
  ...extra,
});

describe("a saved call's trace note (tools spec §6.3)", () => {
  it("cleanToolCalls keeps a note that is a string", () => {
    expect(cleanToolCalls([saved({ note: "today: cut: 12 of 40 items" })])[0]!.note).toBe("today: cut: 12 of 40 items");
  });

  it("cleanToolCalls drops a note that isn't a string, and a call without one has no note key", () => {
    expect(cleanToolCalls([saved({ note: 7 })])[0]).not.toHaveProperty("note");
    expect(cleanToolCalls([saved()])[0]).not.toHaveProperty("note");
  });
});
