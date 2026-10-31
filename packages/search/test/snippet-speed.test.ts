import { describe, expect, it } from "vitest";
import { firstMatch, fold, snippetAround } from "../src";

/** The match finder as first written: one fold per code point. The faster one must agree with it everywhere. */
function reference(text: string, terms: readonly string[]): { start: number; end: number } | null {
  let folded = "";
  const at: number[] = [];
  for (let i = 0; i < text.length; ) {
    const ch = String.fromCodePoint(text.codePointAt(i)!);
    const f = fold(ch);
    for (let k = 0; k < f.length; k++) at.push(i);
    folded += f;
    i += ch.length;
  }
  at.push(text.length);
  let best: { i: number; len: number } | null = null;
  for (const term of terms) {
    if (!term) continue;
    const i = folded.indexOf(term);
    if (i >= 0 && (best === null || i < best.i)) best = { i, len: term.length };
  }
  return best ? { start: at[best.i], end: at[best.i + best.len] } : null;
}

describe("snippets on big files (§4.4)", () => {
  it("finds the same match as folding one code point at a time, in mixed text", () => {
    const texts = [
      "La Fracción y la FRACCION",
      "Ärger über straße STRASSE ß",
      "İstanbul ISTANBUL istanbul",
      "ΟΔΟΣ οδος Σίσυφος",
      "été ÉTÉ ete",
      "́́ lone marks then ete",
      "emoji 😀 then ﬁle and FILE 𝒜bc",
      "plain ascii Context WINDOW context",
      "ﬀoo café CAFE",
    ];
    const terms = ["fraccion", "uber", "strasse", "ß", "istanbul", "οδος", "σισυφος", "ete", "file", "fi", "😀", "context", "window", "abc", "cafe", "oo", "e", "zzz"];
    for (const text of texts) {
      for (const term of terms) expect(firstMatch(text, [term]), `${text} / ${term}`).toEqual(reference(text, [term]));
      expect(firstMatch(text, terms)).toEqual(reference(text, terms));
    }
  });

  it("windows a match deep in a 4 MB file quickly", () => {
    const text = `${"lorem ipsum dolor sit amet, ".repeat(150_000)}the Context window${" tail".repeat(10)}`;
    const a = performance.now();
    const s = snippetAround(text, ["context"]);
    const ms = performance.now() - a;
    expect(s!.at).toBe(text.indexOf("Context"));
    expect(ms).toBeLessThan(250);
  });
});
