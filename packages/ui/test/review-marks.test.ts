// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { drawMarks, findMark, findMarks, paintMarks, textRuns } from "../src/review-marks";

function box(html: string) {
  const el = document.createElement("div");
  el.innerHTML = html;
  document.body.append(el);
  return el;
}

describe("textRuns (§6.1 marks)", () => {
  it("joins blocks with one space, collapses whitespace, skips diagrams", () => {
    const el = box('<h2>Scope</h2><p>Filter   by <strong>size</strong>.</p><div class="hh-md-diagram"><svg><text>A</text></svg></div><p>End.</p>');
    expect(textRuns(el).plain).toBe("Scope Filter by size. End.");
  });

  it("maps each plain character back to its node and offset", () => {
    const el = box("<p>ab <em>cd</em></p>");
    const r = textRuns(el);
    expect(r.at[3].node.textContent).toBe("cd");
    expect(r.at[3].offset).toBe(0);
  });
});

describe("findMark", () => {
  it("finds the n-th match without overlap, or null", () => {
    expect(findMark("aa aa aa", "aa", 1)).toEqual([3, 5]);
    expect(findMark("aaaa", "aa", 1)).toEqual([2, 4]);
    expect(findMark("aa", "aa", 2)).toBeNull();
    expect(findMark("x", "", 0)).toBeNull();
  });

  it("takes linear time on a long run of spaces", () => {
    const t0 = performance.now();
    findMark(`${" ".repeat(50_000)}x`, " ".repeat(40) + "y", 0);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("paintMarks", () => {
  it("returns a range per mark it found, and draws nothing without CSS.highlights", () => {
    const el = box("<p>Filter by size.</p><p>Filter by size.</p>");
    const ranges = paintMarks(el, [
      { id: "c1", want: "Filter by size.", nth: 1, tone: "question" },
      { id: "c2", want: "nowhere", nth: 0, tone: "comment" },
    ]);
    expect([...ranges.keys()]).toEqual(["c1"]);
    expect(ranges.get("c1")?.toString()).toBe("Filter by size.");
  });
});

describe("findMarks and drawMarks", () => {
  it("finds once; drawing for another active card only rebuilds the highlight sets", () => {
    const el = box("<p>Filter by size.</p><p>Sort by date.</p>");
    const marks = [
      { id: "c1", want: "Filter by size.", nth: 0, tone: "question" as const },
      { id: "c2", want: "Sort by date.", nth: 0, tone: "comment" as const },
    ];
    const ranges = findMarks(el, marks);
    const sets = new Map<string, unknown>();
    class FakeHighlight {
      ranges: Range[];
      constructor(...r: Range[]) {
        this.ranges = r;
      }
    }
    // happy-dom has no highlight registry: pass one.
    const api = { highlights: sets, Highlight: FakeHighlight };
    drawMarks(ranges, marks, "c2", api);
    expect((sets.get("hh-review-question") as FakeHighlight).ranges).toEqual([ranges.get("c1")]);
    expect((sets.get("hh-review-active") as FakeHighlight).ranges).toEqual([ranges.get("c2")]);
    drawMarks(ranges, marks, null, api);
    expect((sets.get("hh-review-comment") as FakeHighlight).ranges).toEqual([ranges.get("c2")]);
    expect((sets.get("hh-review-active") as FakeHighlight).ranges).toEqual([]);
  });
});
