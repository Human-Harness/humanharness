import { describe, expect, it } from "vitest";
import { createI18n } from "@humanharness/i18n";
import type { SearchAnswer, SearchHitView } from "../src/client";
import { questionText } from "../src/search/ask";
import { chipsOf, rowsOf, sectionsOf, step } from "../src/search/model";

const hit = (id: string, hint: SearchHitView["hint"]): SearchHitView => ({ id, kind: "file", title: [{ text: id }], context: [], hint, target: { kind: "timeline", path: id } });
const ok = (o: Partial<Extract<SearchAnswer, { ok: true }>>): SearchAnswer => ({ ok: true, query: "q", groups: [], counts: { task: 0, note: 0, file: 0 }, recent: [], partial: false, status: { state: "ready", done: 0, total: 0 }, allScopes: false, ...o });

describe("the palette's model", () => {
  it("an empty query shows the recents; a query its groups in order", () => {
    expect(sectionsOf(ok({ query: "", recent: [hit("a", null)] })).map((s) => s.key)).toEqual(["recent"]);
    const a = ok({ groups: [{ kind: "task", total: 1, hits: [hit("t", null)] }, { kind: "file", total: 9, hits: [hit("f", null)] }] });
    expect(sectionsOf(a).map((s) => s.key)).toEqual(["task", "file"]);
    expect(rowsOf(sectionsOf(a)).map((h) => h.id)).toEqual(["t", "f"]);
    expect(sectionsOf({ ok: false, reason: "failed" })).toEqual([]);
  });

  it("chips: All with the sum, then each kind with matches", () => {
    expect(chipsOf(ok({ counts: { task: 2, note: 0, file: 7 } }))).toEqual([
      { kind: null, count: 9 },
      { kind: "task", count: 2 },
      { kind: "file", count: 7 },
    ]);
    expect(chipsOf(ok({ query: "" }))).toEqual([]);
  });

  it("moves stay inside the list", () => {
    expect(step(0, -1, 3)).toBe(0);
    expect(step(2, 1, 3)).toBe(2);
    expect(step(1, 1, 3)).toBe(2);
    expect(step(5, 1, 0)).toBe(0);
  });
});

describe("questionText (§5.4)", () => {
  it("the query, then up to three hints: paths in code, notes and tasks by title; never a hintless row", async () => {
    const { t } = await createI18n("en");
    const hits = [hit("a", { kind: "task", text: "The turn" }), hit("b", null), hit("c", { kind: "path", text: "docs/architecture/context.md" }), hit("d", { kind: "note", text: "Engines" }), hit("e", { kind: "name", text: "x.md" })];
    expect(questionText("  context  ", hits, t)).toBe('context\n\nPossibly related: task "The turn", `docs/architecture/context.md`, note "Engines".');
    expect(questionText("context", [], t)).toBe("context");
    expect(questionText("   ", hits, t)).toBeNull();
  });
});
