import { describe, expect, it } from "vitest";
import { firstMatch, markFirst, snippetAround } from "../src";

const joined = (parts: { text: string; mark?: true }[]) => parts.map((p) => (p.mark ? `[${p.text}]` : p.text)).join("");

describe("marks and snippets (§5.3)", () => {
  it("marks the first match in the original text, accents kept", () => {
    expect(joined(markFirst("La Fracción y la fracción", ["fraccion"]))).toBe("La [Fracción] y la fracción");
    expect(markFirst("nothing here", ["context"])).toEqual([{ text: "nothing here" }]);
  });

  it("takes the earliest of several terms", () => {
    expect(firstMatch("beta alpha", ["alpha", "beta"])).toEqual({ start: 0, end: 4 });
  });

  it("windows about 120 characters around the match, with ellipses where it cuts", () => {
    const text = `${"a ".repeat(200)}the context window${" b".repeat(200)}`;
    const s = snippetAround(text, ["context"]);
    const out = joined(s!.marked);
    expect(out.startsWith("…")).toBe(true);
    expect(out.endsWith("…")).toBe(true);
    expect(out).toContain("[context]");
    expect(out.length).toBeLessThanOrEqual(124);
    expect(s!.at).toBe(text.indexOf("context"));
  });

  it("at the start and the end of a file there is no ellipsis on that side", () => {
    expect(joined(snippetAround("context first", ["context"])!.marked)).toBe("[context] first");
    expect(joined(snippetAround("ends with context", ["context"])!.marked)).toBe("ends with [context]");
  });

  it("never cuts a surrogate pair, and squashes line breaks", () => {
    const text = `${"😀".repeat(100)}\n\nthe context`;
    const out = joined(snippetAround(text, ["context"])!.marked);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(out).toContain(" the [context]");
  });

  it("is null without a match", () => {
    expect(snippetAround("abc", ["zzz"])).toBeNull();
  });
});
