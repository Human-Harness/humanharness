import { describe, expect, it } from "vitest";
import { MAX_DIFF_CHARS, MAX_DIFF_LINES, lineDiff, matchGlob, validApproveGlob } from "../src/review";

describe("lineDiff", () => {
  it("marks removed and added lines around what stayed", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { kind: "same", text: "a" },
      { kind: "removed", text: "b" },
      { kind: "added", text: "B" },
      { kind: "same", text: "c" },
      { kind: "added", text: "d" },
    ]);
  });

  it("keeps equal texts as all same, and swaps an empty text for a line", () => {
    expect(lineDiff("a\nb", "a\nb")).toEqual([
      { kind: "same", text: "a" },
      { kind: "same", text: "b" },
    ]);
    expect(lineDiff("", "x")).toEqual([{ kind: "added", text: "x" }]);
  });

  it("a final newline adds no empty line", () => {
    expect(lineDiff("a\n", "a\nb\n")).toEqual([
      { kind: "same", text: "a" },
      { kind: "added", text: "b" },
    ]);
  });

  it("gives up above the line limit", () => {
    expect(lineDiff("x\n".repeat(MAX_DIFF_LINES + 1), "y")).toBeNull();
    expect(lineDiff("y", "x\n".repeat(MAX_DIFF_LINES + 1))).toBeNull();
  });

  it("gives up above the character limit before splitting", () => {
    expect(lineDiff("a".repeat(MAX_DIFF_CHARS + 1), "a")).toBeNull();
  });

  it("stays fast at the limit, with every line different and long lines sharing a prefix", () => {
    const long = "p".repeat(400);
    const a = Array.from({ length: MAX_DIFF_LINES }, (_, i) => `${long}a${i}`).join("\n");
    const b = Array.from({ length: MAX_DIFF_LINES }, (_, i) => `${long}b${i}`).join("\n");
    const t0 = performance.now();
    const d = lineDiff(a, b);
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(d).toHaveLength(2 * MAX_DIFF_LINES);
  });
});

describe("matchGlob", () => {
  it.each([
    ["tickets/*/spec.md", "tickets/SHOP-142/spec.md", true],
    ["tickets/*/spec.md", "tickets/a/b/spec.md", false],
    ["tickets/**/spec.md", "tickets/a/b/spec.md", true],
    ["tickets/**/spec.md", "tickets/spec.md", true],
    ["spec?.md", "spec1.md", true],
    ["spec?.md", "spec.md", false],
    ["*.md", "docs/a.md", false],
    ["**/*.md", "docs/a.md", true],
    ["**", "a/b/c.md", true],
    ["a*b*c.md", "aXbYc.md", true],
    ["a*b*c.md", "aXbY.md", false],
    ["tickets/*/SPEC.MD", "Tickets/a/spec.md", true],
  ])("%s ~ %s → %s", (p, path, want) => expect(matchGlob(p, path)).toBe(want));

  it("is fast on many stars", () => {
    const t0 = performance.now();
    expect(matchGlob(`${"*a".repeat(200)}.md`, `${"a".repeat(5000)}b.md`)).toBe(false);
    expect(matchGlob(`${"**/".repeat(50)}x.md`, `${"a/".repeat(500)}y.md`)).toBe(false);
    expect(performance.now() - t0).toBeLessThan(500);
  });

  it("does not recurse on deep paths", () => {
    expect(matchGlob("**/x.md", `${"a/".repeat(50_000)}x.md`)).toBe(true);
  });
});

describe("validApproveGlob", () => {
  it.each([
    ["tickets/*/spec.md", true],
    ["**/plan.md", true],
    ["SPEC.MD", true],
    ["/abs/spec.md", false],
    ["../spec.md", false],
    ["a/../spec.md", false],
    ["./spec.md", false],
    ["a//spec.md", false],
    ["a\\b.md", false],
    ["tickets/[ab]/spec.md", false],
    ["tickets/{a,b}.md", false],
    ["spec.txt", false],
    [".harness/x.md", false],
    ["a**b/x.md", false],
    ["", false],
    [`${"a".repeat(200)}.md`, false],
    [42, false],
  ])("%s → %s", (p, ok) => expect(validApproveGlob(p)).toBe(ok));
});
