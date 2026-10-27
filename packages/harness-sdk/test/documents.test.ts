import { describe, expect, it } from "vitest";
import {
  CALLOUTS,
  DOCUMENT_KIND_ID,
  checkTemplate,
  createSlugger,
  documentTitle,
  isMarkdownPath,
  readingMinutes,
  refusedShape,
  splitFrontMatter,
  summarizeDocument,
  wordCount,
} from "../src/documents";
import { type HarnessInput, defineHarness } from "../src";

describe("splitFrontMatter", () => {
  it("reads simple key: value pairs and strips the block from the body", () => {
    const fm = splitFrontMatter('---\ntitle: "ADR 7: Cache"\nkind: adr\nstatus: \'accepted\'\n---\n# Body\n');
    expect(fm).toEqual({ data: { title: "ADR 7: Cache", kind: "adr", status: "accepted" }, body: "# Body\n", broken: false, lines: 5 });
  });

  it("no front-matter: everything is body", () => {
    expect(splitFrontMatter("# Hi\n---\n")).toEqual({ data: {}, body: "# Hi\n---\n", broken: false, lines: 0 });
  });

  it("an unclosed block is not front-matter", () => {
    expect(splitFrontMatter("---\ntitle: x\n").data).toEqual({});
    expect(splitFrontMatter("---\ntitle: x\n").body).toBe("---\ntitle: x\n");
  });

  it("broken front-matter is hidden but ignored (§6)", () => {
    const fm = splitFrontMatter("---\ntitle: x\nthis is not yaml\n---\nText");
    expect(fm).toEqual({ data: {}, body: "Text", broken: true, lines: 4 });
  });

  it("skips indented lines, comments and empty lines; takes CRLF and a BOM", () => {
    const fm = splitFrontMatter("\uFEFF---\r\ntags:\r\n  - a\r\n# note\r\n\r\ntitle: T\r\n...\r\nX");
    expect(fm.data).toEqual({ tags: "", title: "T" });
    expect(fm.body).toBe("X");
  });
});

describe("createSlugger", () => {
  it("makes GitHub-style ids, deduplicated in order", () => {
    const slug = createSlugger();
    expect(slug("Alternatives considered")).toBe("alternatives-considered");
    expect(slug("Alternatives considered")).toBe("alternatives-considered-1");
    expect(slug("¿Qué pasa? — Ñandú")).toBe("qué-pasa--ñandú");
    expect(slug("!!!")).toBe("section");
    expect(slug("!!!")).toBe("section-1");
  });
});

describe("documentTitle", () => {
  it("front-matter title, else the first # heading outside code, else the file name", () => {
    expect(documentTitle("a/b.md", "---\ntitle: From FM\n---\n# H1")).toBe("From FM");
    expect(documentTitle("a/b.md", "```\n# not this\n```\n## Two\n# Real one #\n")).toBe("Real one");
    expect(documentTitle("tickets/MUS-412/analysis.md", "No heading")).toBe("analysis");
  });
});

describe("words and reading time", () => {
  it("counts the body's words, without the front-matter", () => {
    expect(wordCount("---\ntitle: a b c\n---\none two\nthree")).toBe(3);
  });
  it("230 words a minute, at least one", () => {
    expect(readingMinutes(0)).toBe(1);
    expect(readingMinutes(230)).toBe(1);
    expect(readingMinutes(231)).toBe(2);
  });
});

describe("isMarkdownPath", () => {
  it("takes .md in any case, nothing else", () => {
    expect(isMarkdownPath("a/B.MD")).toBe(true);
    expect(isMarkdownPath("a.markdown")).toBe(false);
    expect(isMarkdownPath("a.md.txt")).toBe(false);
  });
});

describe("summarizeDocument", () => {
  it("title, kind and words for a card", () => {
    expect(summarizeDocument("x/plan.md", "---\nkind: analysis\n---\n# The plan\nGo now.")).toEqual({ title: "The plan", kind: "analysis", words: 5 });
    expect(summarizeDocument("x/plan.md", "Hi")).toEqual({ title: "plan", words: 1 });
  });
});

describe("checkTemplate (§4.3)", () => {
  const kinds = {
    analysis: { when: "x", sections: ["Context", "Options", "Risks"] },
    adr: { when: "y", sections: ["Status"], status: ["proposed", "accepted"] },
  };
  it("a missing section, matched without case and trimmed; order and extras are fine", () => {
    expect(checkTemplate(kinds, { kind: "analysis" }, ["  options ", "CONTEXT", "Extra"])).toEqual({ kind: "analysis", missing: ["Risks"] });
  });
  it("an unknown kind", () => {
    expect(checkTemplate(kinds, { kind: "memo" }, [])).toEqual({ kind: "memo", unknownKind: true, missing: [] });
  });
  it("a status outside the kind's list", () => {
    expect(checkTemplate(kinds, { kind: "adr", status: "done" }, ["Status"])).toEqual({ kind: "adr", missing: [], badStatus: "done" });
    expect(checkTemplate(kinds, { kind: "adr", status: "accepted" }, ["Status"])).toEqual({ kind: "adr", missing: [] });
  });
  it("no kind, or no kinds declared: no check", () => {
    expect(checkTemplate(kinds, {}, [])).toBeNull();
    expect(checkTemplate(undefined, { kind: "adr" }, [])).toBeNull();
    expect(checkTemplate({}, { kind: "adr" }, [])).toBeNull();
  });
});

describe("constants", () => {
  it("six callouts, three GitHub's and three of the core", () => {
    expect(CALLOUTS).toEqual(["note", "tip", "warning", "summary", "decision", "question"]);
  });
  it("kind ids are lowercase", () => {
    expect(DOCUMENT_KIND_ID.test("adr")).toBe(true);
    expect(DOCUMENT_KIND_ID.test("design-doc2")).toBe(true);
    expect(DOCUMENT_KIND_ID.test("ADR")).toBe(false);
    expect(DOCUMENT_KIND_ID.test("2x")).toBe(false);
  });
});

describe("hostile and edge input", () => {
  it("a long run of spaces in a heading stays linear (no ReDoS)", () => {
    const t0 = performance.now();
    expect(documentTitle("a.md", `# x${" ".repeat(50_000)}y`)).toBe(`x${" ".repeat(50_000)}y`);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("a long run of spaces in a front-matter value stays linear (no ReDoS)", () => {
    const t0 = performance.now();
    const fm = splitFrontMatter(`---\ntitle: a${" ".repeat(50_000)}b${" ".repeat(50_000)}\n---\n`);
    expect(fm.data.title).toBe(`a${" ".repeat(50_000)}b`);
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it("closing #s are stripped only after whitespace", () => {
    expect(documentTitle("a.md", "# C# ##  ")).toBe("C#");
    expect(documentTitle("a.md", "# C#")).toBe("C#");
  });

  it("a fence closes only on the same character, at least as long, with nothing else on the line", () => {
    expect(documentTitle("a.md", "````\n```\n# no\n```js\n# no\n````\n# Yes")).toBe("Yes");
    expect(documentTitle("a.md", "```\n~~~\n# no\n```\n# Yes")).toBe("Yes");
  });

  it("the closing delimiter may carry trailing spaces", () => {
    expect(splitFrontMatter("---\ntitle: T\n---  \nBody")).toEqual({ data: { title: "T" }, body: "Body", broken: false, lines: 3 });
  });
});

const base: HarnessInput = {
  id: "dev",
  name: "Dev",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Dev" },
  instructions: "./AGENTS.md",
  permissions: { edit: "folder", exec: false, web: false },
  blocks: {},
  author: "t",
};

describe("manifest documents (§4.2)", () => {
  it("takes kinds with when, sections and an optional status", () => {
    const h = defineHarness({
      ...base,
      documents: {
        kinds: {
          adr: { when: "A decision with real alternatives.", sections: ["Status", "Context"], status: ["proposed", "accepted"] },
          analysis: { when: "Exploring options.", sections: ["Context"] },
        },
      },
    });
    expect(Object.keys(h.documents!.kinds)).toEqual(["adr", "analysis"]);
  });

  it("refuses a bad id, an empty sections list, an empty heading and an empty when", () => {
    expect(() => defineHarness({ ...base, documents: { kinds: { ADR: { when: "x", sections: ["A"] } } } })).toThrow();
    expect(() => defineHarness({ ...base, documents: { kinds: { adr: { when: "x", sections: [] } } } })).toThrow();
    expect(() => defineHarness({ ...base, documents: { kinds: { adr: { when: "x", sections: [" "] } } } })).toThrow();
    expect(() => defineHarness({ ...base, documents: { kinds: { adr: { when: "", sections: ["A"] } } } })).toThrow();
    expect(() => defineHarness({ ...base, documents: { kinds: { adr: { when: "x", sections: ["A"], status: [] } } } })).toThrow();
  });

  it("refuses the same section twice in a kind", () => {
    expect(() => defineHarness({ ...base, documents: { kinds: { adr: { when: "x", sections: ["Context", "context "] } } } })).toThrow(/twice/);
  });

  it("D0: without documents the manifest has no documents field", () => {
    expect("documents" in defineHarness(base)).toBe(false);
  });
});

describe("wordCount on large or odd text", () => {
  it("counts runs of any JavaScript whitespace, like split(/\\s+/)", () => {
    const text = "a\tb\u00a0c\u2003d\u3000e\ufeff f\n\n  g";
    expect(wordCount(text)).toBe(text.split(/\s+/).filter(Boolean).length);
    expect(wordCount("")).toBe(0);
    expect(wordCount("   ")).toBe(0);
  });

  it("is linear: 50k spaces and a 5 MB body stay fast", () => {
    const started = Date.now();
    expect(wordCount(`a${" ".repeat(50_000)}b`)).toBe(2);
    expect(wordCount("word ".repeat(1_000_000))).toBe(1_000_000);
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("refusedShape", () => {
  it("refuses what is not a plain relative path", () => {
    for (const rel of [null, 3, "", "a".repeat(1001), "a\0.md", "a\\b.md", "/abs.md", "//host/x.md", "C:a.md", "..", "../x.md", "./../x.md", "a/../../x.md", "../a/.."])
      expect(refusedShape(rel)).toBe(true);
  });
  it("takes plain relative paths, also with a leading ./ or a .. that stays inside", () => {
    for (const rel of ["docs/plan.md", "./docs/plan.md", "docs/../docs/plan.md", "a..b.md", "..hidden.md", "a/b/../../c.md"]) expect(refusedShape(rel)).toBe(false);
  });
  it("is fast on a long path of spaces", () => {
    const started = Date.now();
    expect(refusedShape(" ".repeat(50_000))).toBe(true);
    expect(refusedShape(`${" ".repeat(999)}`)).toBe(false);
    expect(Date.now() - started).toBeLessThan(100);
  });
});
