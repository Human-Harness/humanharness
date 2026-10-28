import { describe, expect, it, vi } from "vitest";

// The parser overflows its stack on some deep nesting the pre-scan may not foresee; any throw must show the text view.
vi.mock("remark-parse", () => ({
  default: function remarkParse(this: { parser: unknown }) {
    this.parser = () => {
      throw new RangeError("Maximum call stack size exceeded");
    };
  },
}));

const { diffFile, diffMarkdown } = await import("../src/file-diff");
const side = (text: string) => ({ kind: "bytes" as const, bytes: Buffer.from(text), size: Buffer.byteLength(text) });

describe("a parser throw (file-timeline spec §4.2)", () => {
  it("diffMarkdown answers null and diffFile the plain text diff", () => {
    expect(diffMarkdown("A.\n", "B.\n")).toBeNull();
    const d = diffFile("a.md", side("A.\n"), side("B.\n"));
    expect(d).toMatchObject({ ok: true, kind: "text", lang: "md", same: false });
    if (d.kind !== "text") throw new Error("not text");
    expect(d.lines.map((l) => l.kind)).toEqual(["del", "ins"]);
  });
});
