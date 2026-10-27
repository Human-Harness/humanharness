import { describe, expect, it } from "vitest";
import { anchorAt, anchorForSelection, anchorOf, diagramOf, locate, markOccurrence, plainInline, project, sections } from "../src/review";

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
    project(text);
    anchorForSelection(text, "y", "a");
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe("project", () => {
  it("leaves out markup and block markers, one space per whitespace run, and maps back", () => {
    const src = "---\ntitle: T\n---\n## The **size**\n\n- [ ] keep `it`\n> quoted [link](x.md)\n| a | b |\n";
    const p = project(src);
    expect(p.plain).toBe("The size keep it quoted link a b");
    expect(src[p.map[p.plain.indexOf("size")]]).toBe("s");
  });

  it("keeps code fences' content literally and drops the fence lines", () => {
    expect(project("```ts\nconst *a* = 1;\n```\n").plain).toBe("const *a* = 1;");
  });

  it("projects a fragment without looking for front-matter", () => {
    expect(project("---\nx\n---", { frontMatter: false }).plain).toBe("--- x ---");
  });
});

describe("anchorForSelection", () => {
  const src = "## Scope\n\nThe **size** filter keeps.\n\n## Risks\n\nThe size filter keeps.\n";
  it("maps a rendered selection to an exact source passage, preferring the heading's section", () => {
    const a = anchorForSelection(src, " The size  filter\n", "risks");
    expect(a).toEqual({ quote: "The size filter", heading: "risks", occurrence: 0 });
    const b = anchorForSelection(src, "The size filter", "scope");
    expect(b).toEqual({ quote: "The **size** filter", heading: "scope", occurrence: 0 });
  });

  it("takes the first match anywhere when the heading's section has none, and null when nothing matches", () => {
    expect(anchorForSelection(src, "The size filter", null)?.heading).toBe("scope");
    expect(anchorForSelection(src, "absent", null)).toBeNull();
    expect(anchorForSelection(src, "   ", null)).toBeNull();
  });
});

describe("markOccurrence", () => {
  it("says which rendered match a passage is", () => {
    const src = "## A\n\nword word\n\n## B\n\nword\n";
    expect(markOccurrence(src, { quote: "word", heading: "b", occurrence: 0 })).toEqual({ want: "word", nth: 2 });
    expect(markOccurrence(src, { quote: "gone", heading: "b", occurrence: 0 })).toBeNull();
  });
});

describe("diagramOf", () => {
  it("names the section of a quote inside a mermaid fence", () => {
    const src = "## Flow\n\n```mermaid\nflowchart LR\n  A --> B\n```\n";
    expect(diagramOf(src, src.indexOf("A --> B"))).toBe("Flow");
    expect(diagramOf(src, src.indexOf("## Flow"))).toBeNull();
  });
});
