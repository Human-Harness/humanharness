import { describe, expect, it } from "vitest";
import { MAX_DIFF_BYTES, cutBytes, diffFile, isBinary, lineChanges, wordParts } from "../src/file-diff";

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

  it("never stalls on long runs of spaces (no backtracking on document text)", () => {
    const start = performance.now();
    wordParts(`${" ".repeat(50_000)}a`, `${" ".repeat(50_000)}b`);
    lineChanges(`${" ".repeat(50_000)}\n`, `${" ".repeat(49_999)}\n`);
    expect(performance.now() - start).toBeLessThan(2500);
  });
});
