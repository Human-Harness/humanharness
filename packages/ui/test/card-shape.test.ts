import { describe, expect, it } from "vitest";
import { cleanDocumentCards } from "../src/card-shape";

describe("cleanDocumentCards (a chat file read from disk is untrusted)", () => {
  const good = { path: "docs/a.md", title: "A", kind: "analysis", change: "new", words: 12 };

  it("keeps well-formed cards as they are", () => {
    expect(cleanDocumentCards([good, { path: "b.md", title: "B", change: "updated", words: 0 }])).toEqual([
      good,
      { path: "b.md", title: "B", change: "updated", words: 0 },
    ]);
  });

  it("keeps only the first card of a path", () => {
    expect(cleanDocumentCards([good, { ...good, title: "Again" }])).toEqual([good]);
  });

  it("drops malformed cards and anything that is not a list", () => {
    for (const bad of [null, "x", 3, { path: "a.md" }]) expect(cleanDocumentCards(bad)).toEqual([]);
    expect(
      cleanDocumentCards([
        null,
        "a.md",
        { ...good, path: 7 },
        { ...good, path: "../out.md" },
        { ...good, path: "/abs.md" },
        { ...good, title: {} },
        { ...good, change: "deleted" },
        { ...good, words: Number.NaN },
        { ...good, words: -1 },
        { ...good, words: "12" },
        { ...good, kind: 3 },
      ]),
    ).toEqual([]);
  });

  it("keeps only the known fields, and at most 20 cards", () => {
    expect(cleanDocumentCards([{ ...good, extra: "<b>" }])).toEqual([good]);
    expect(cleanDocumentCards(Array.from({ length: 30 }, (_, i) => ({ ...good, path: `d${i}.md` })))).toHaveLength(20);
  });
});
