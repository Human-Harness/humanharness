import { describe, expect, it } from "vitest";
import { anchorAt, anchorOf, locate, plainInline, sections } from "../src/review";

const DOC = [
  "---",
  "title: Filter",
  "---",
  "Intro keeps it short.",
  "",
  "## Scope",
  "",
  "The size filter keeps the size. The size filter keeps it.",
  "",
  "```",
  "## not a heading",
  "```",
  "",
  "## The **Risks**",
  "",
  "The size filter keeps nothing.",
  "",
].join("\n");

describe("sections", () => {
  it("splits at #–#### headings outside code, after the front-matter, with the reader's slugs", () => {
    const s = sections(DOC);
    expect(s.map((x) => x.slug)).toEqual([null, "scope", "the-risks"]);
    expect(s.map((x) => x.title)).toEqual(["", "Scope", "The Risks"]);
    expect(s[1].level).toBe(2);
    expect(DOC.slice(s[1].start, s[1].start + 8)).toBe("## Scope");
    expect(s[0].end).toBe(s[1].start);
    expect(s[2].end).toBe(DOC.length);
  });

  it("ignores ##### and deeper, and a # without a space", () => {
    expect(sections("##### deep\n#tag\n# Top\n").map((x) => x.slug)).toEqual([null, "top"]);
  });

  it("deduplicates slugs like the reader", () => {
    expect(sections("## A\n## A\n").map((x) => x.slug)).toEqual([null, "a", "a-1"]);
  });
});

describe("plainInline", () => {
  it("drops emphasis, code and link syntax, keeps snake_case", () => {
    expect(plainInline("The **size** `filter` [docs](a.md) snake_case \\*x")).toBe("The size filter docs snake_case *x");
  });
});

describe("anchorAt and anchorOf", () => {
  it("takes the first match, counted under its heading", () => {
    const r = anchorAt(DOC, "The size filter keeps");
    expect(r).toMatchObject({ ok: true, anchor: { quote: "The size filter keeps", heading: "scope", occurrence: 0 } });
  });

  it("takes the first match under the heading given", () => {
    const r = anchorAt(DOC, "The size filter keeps", "the-risks");
    expect(r).toMatchObject({ ok: true, anchor: { heading: "the-risks", occurrence: 0 } });
  });

  it("refuses a quote that isn't there, or isn't under the heading, or an unknown heading", () => {
    expect(anchorAt(DOC, "no such text")).toEqual({ ok: false, reason: "not-found" });
    expect(anchorAt(DOC, "Intro keeps", "scope")).toEqual({ ok: false, reason: "not-found" });
    expect(anchorAt(DOC, "Intro keeps", "nope")).toEqual({ ok: false, reason: "no-heading" });
    expect(anchorAt(DOC, "")).toEqual({ ok: false, reason: "not-found" });
  });

  it("counts the second match under the same heading", () => {
    const second = DOC.indexOf("The size filter keeps it.");
    expect(anchorOf(DOC, second, "The size filter keeps")).toEqual({ quote: "The size filter keeps", heading: "scope", occurrence: 1 });
  });
});

describe("locate", () => {
  it("finds the n-th match in its section", () => {
    const at = locate(DOC, { quote: "The size filter keeps", heading: "scope", occurrence: 1 });
    expect(at?.start).toBe(DOC.indexOf("The size filter keeps it."));
  });

  it("falls back to the last match in the section, then anywhere, then null", () => {
    expect(locate(DOC, { quote: "The size filter keeps", heading: "scope", occurrence: 7 })?.start).toBe(DOC.indexOf("The size filter keeps it."));
    expect(locate(DOC, { quote: "Intro keeps", heading: "scope", occurrence: 0 })?.start).toBe(DOC.indexOf("Intro keeps"));
    expect(locate(DOC, { quote: "gone", heading: "scope", occurrence: 0 })).toBeNull();
  });

  it("strict: only inside its section", () => {
    expect(locate(DOC, { quote: "Intro keeps", heading: "scope", occurrence: 0 }, { strict: true })).toBeNull();
  });

  it("an unknown heading searches the whole text", () => {
    expect(locate(DOC, { quote: "Intro keeps", heading: "renamed", occurrence: 0 })?.start).toBe(DOC.indexOf("Intro keeps"));
  });
});

describe("no backtracking on document text", () => {
  it("scans 50,000 spaces fast", () => {
    const text = `## A${" ".repeat(50_000)}\n#${" ".repeat(50_000)}x\n${"`".repeat(3)}${" ".repeat(50_000)}`;
    const t0 = performance.now();
    sections(text);
    anchorAt(text, " ".repeat(40) + "y");
    locate(text, { quote: " ".repeat(30) + "z", heading: "a", occurrence: 3 });
    plainInline(`${"*_`[".repeat(10_000)}](${" ".repeat(50_000)}`);
    expect(performance.now() - t0).toBeLessThan(500);
  });
});
