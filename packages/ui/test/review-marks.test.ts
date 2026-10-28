// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { findMark, paintMarks, textRuns } from "../src/review-marks";

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
