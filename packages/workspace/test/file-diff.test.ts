import { describe, expect, it } from "vitest";
import { DIFF_CONTEXT_LINES, MAX_DIFF_BYTES, MAX_DIFF_LINES, compactLines, cutBytes, diffFile, isBinary, lineChanges, textDiff, wordParts } from "../src/file-diff";

const side = (text: string) => ({ kind: "bytes" as const, bytes: Buffer.from(text), size: Buffer.byteLength(text) });
const absent = { kind: "absent" as const };
/** One side of a word diff, read back: the common parts plus that side's own. */
const sideOf = (parts: { kind: string; text: string }[], kind: "del" | "ins") =>
  parts
    .filter((p) => p.kind === "same" || p.kind === kind)
    .map((p) => p.text)
    .join("");

describe("file diff basics (file-timeline spec §4)", () => {
  it("line changes carry old and new line numbers", () => {
    expect(lineChanges("a\nb\nc\n", "a\nB\nc\nd\n")).toEqual([
      { kind: "same", text: "a", old: 1, new: 1 },
      { kind: "del", text: "b", old: 2 },
      { kind: "ins", text: "B", new: 2 },
      { kind: "same", text: "c", old: 3, new: 3 },
      { kind: "ins", text: "d", new: 4 },
    ]);
  });

  it("word parts keep the spaces: each side reads back whole", () => {
    const parts = wordParts("Filter by size.", "Filter by size and colour.");
    expect(sideOf(parts, "del")).toBe("Filter by size.");
    expect(sideOf(parts, "ins")).toBe("Filter by size and colour.");
    expect(parts[0]).toEqual({ kind: "same", text: expect.stringContaining("Filter by ") });
    expect(parts.some((p) => p.kind === "ins" && p.text.includes("colour"))).toBe(true);
    expect(wordParts("same", "same")).toEqual([{ kind: "same", text: "same" }]);
  });

  it("binary: a NUL in the first 8 KB, or a known extension", () => {
    expect(isBinary("a.txt", Buffer.from("plain"))).toBe(false);
    expect(isBinary("a.txt", Buffer.from([65, 0, 66]))).toBe(true);
    expect(isBinary("photo.PNG", Buffer.from("not really"))).toBe(true);
    expect(isBinary("a.txt", Buffer.concat([Buffer.alloc(9000, 65), Buffer.from([0])]))).toBe(false);
  });

  it("cuts to whole UTF-8 characters", () => {
    expect(Buffer.from(cutBytes(Buffer.from("aé"), 2)).toString()).toBe("a");
    expect(Buffer.from(cutBytes(Buffer.from("aé"), 3)).toString()).toBe("aé");
  });

  it("a text file: lines, its language from the extension, same or not", () => {
    const d = diffFile("src/a.ts", side("let a = 1;\n"), side("let a = 2;\n"));
    expect(d).toMatchObject({ ok: true, kind: "text", same: false, truncated: false, lang: "ts" });
    expect(diffFile("notes.txt", side("x"), side("x"))).toMatchObject({ kind: "text", same: true, lang: "txt" });
    expect(diffFile("Makefile", side("x"), side("x"))).toMatchObject({ kind: "text", lang: null });
    expect(diffFile("new.txt", absent, side("x\n"))).toMatchObject({ kind: "text", lines: [{ kind: "ins", text: "x", new: 1 }] });
  });

  it("binary: sizes only", () => {
    expect(diffFile("a.png", side("12"), absent)).toEqual({ ok: true, kind: "binary", same: false, sizes: { before: 2, after: null } });
  });

  it("large sides are cut to 200 KB, with a notice", () => {
    const big = "x\n".repeat(MAX_DIFF_BYTES);
    expect(diffFile("big.txt", side(big), side(`${big}y\n`))).toMatchObject({ kind: "text", truncated: true, same: false });
  });

  it("CRLF line endings don't show as part of the text", () => {
    expect(lineChanges("a\r\nb\r\n", "a\r\nc\r\n").map((l) => [l.kind, l.text])).toEqual([
      ["same", "a"],
      ["del", "b"],
      ["ins", "c"],
    ]);
  });

  it("unchanged runs far from a change collapse into one gap with their count", () => {
    const lines = lineChanges("1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n", "1\n2\n3\n4\n5\nX\n7\n8\n9\n10\n");
    const { lines: kept, cut } = compactLines(lines, 2);
    expect(cut).toBe(false);
    expect(kept.map((l) => (l.kind === "gap" ? `gap ${l.count}` : `${l.kind} ${l.text}`))).toEqual([
      "gap 3",
      "same 4",
      "same 5",
      "del 6",
      "ins X",
      "same 7",
      "same 8",
      "gap 2",
    ]);
    // Nothing changed: no line at all, only the gap.
    expect(compactLines(lineChanges("a\nb\n", "a\nb\n")).lines).toEqual([{ kind: "gap", text: "", count: 2 }]);
  });

  it("the line cap counts only real lines, never gap rows", () => {
    // Four changes, each far from the next: gap, ins, gap, ins, gap, ins, gap, ins.
    const lines = lineChanges("a\nb\nc\nd\n", "a\nX\nb\nX\nc\nX\nd\nX\n");
    const three = compactLines(lines, 0, 3);
    expect(three.lines.filter((l) => l.kind !== "gap")).toHaveLength(3);
    expect(three.cut).toBe(true);
    // Exactly at the cap, with only unchanged lines left: nothing real is dropped, so nothing is cut.
    const four = compactLines(lineChanges("a\nb\nc\nd\ne\nf\n", "X\nb\nc\nd\ne\nf\n"), 0, 2);
    expect(four.lines.map((l) => l.kind)).toEqual(["del", "ins", "gap"]);
    expect(four.cut).toBe(false);
  });

  it("a big text diff stays small: 200 KB of short lines with one change, or every line changed", () => {
    const before = "a\n\n".repeat(68_000);
    const after = `${before.slice(0, 100_000)}b${before.slice(100_000)}`;
    const one = textDiff("log.txt", side(before), side(after));
    if (one.kind !== "text") throw new Error(one.kind);
    expect(JSON.stringify(one).length).toBeLessThan(5_000);
    expect(one.lines.filter((l) => l.kind === "same")).toHaveLength(2 * DIFF_CONTEXT_LINES);
    // A spent budget: every line removed, then added. Capped, and said so.
    const all = textDiff("log.txt", side(before), side(after), 0);
    if (all.kind !== "text") throw new Error(all.kind);
    expect(all.lines.length).toBeLessThanOrEqual(MAX_DIFF_LINES);
    expect(all.truncated).toBe(true);
    expect(JSON.stringify(all).length).toBeLessThan(1_000_000);
    // The Markdown view's source lines are compacted the same way.
    const shorter = "a\n\n".repeat(2000);
    const md = diffFile("notes.md", side(shorter), side(`${shorter}b\n`));
    if (md.kind !== "markdown") throw new Error(md.kind);
    expect(md.source.length).toBeLessThan(20);
  });

  it("never stalls on long runs of spaces (no backtracking on document text)", () => {
    const start = performance.now();
    wordParts(`${" ".repeat(50_000)}a`, `${" ".repeat(50_000)}b`);
    lineChanges(`${" ".repeat(50_000)}\n`, `${" ".repeat(49_999)}\n`);
    expect(performance.now() - start).toBeLessThan(2500);
  });
});
