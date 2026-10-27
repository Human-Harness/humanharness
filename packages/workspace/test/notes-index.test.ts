import { describe, expect, it } from "vitest";
import { type Note, buildNotesIndex, estimateTokens } from "../src";

const note = (i: number, extra: Partial<Note> = {}): Note => ({
  slug: `n${i}`,
  path: `.harness/notes/n${i}.md`,
  title: `Topic ${i}`,
  action: `t${i}`,
  date: new Date(Date.UTC(2026, 9, 1) + i * 3_600_000).toISOString(),
  engine: "claude",
  summary: [`point ${i}a`, `point ${i}b`],
  decisions: [`decision ${i}`],
  files: [],
  open: [],
  ...extra,
});

describe("buildNotesIndex", () => {
  it("is empty without notes", () => {
    expect(buildNotesIndex([])).toBe("");
  });

  it("lists what was covered, newest first, then the decisions", () => {
    expect(buildNotesIndex([note(1), note(2, { action: undefined })])).toBe(
      [
        "## What we already covered",
        "- Topic 2: point 2a; point 2b → .harness/notes/n2.md",
        "- Topic 1 (t1): point 1a; point 1b → .harness/notes/n1.md",
        "",
        "## Decisions so far",
        "- decision 2",
        "- decision 1",
        "",
        "Open a note with your read tool when you need its details.",
      ].join("\n"),
    );
  });

  it("collapses the oldest notes to title and path to fit the budget", () => {
    const long = (i: number) => note(i, { summary: ["x".repeat(400)] });
    const index = buildNotesIndex([long(1), long(2), long(3)], { budgetTokens: 250 });
    expect(estimateTokens(index)).toBeLessThanOrEqual(250);
    expect(index).toContain("- Topic 1 (t1) → .harness/notes/n1.md");
    expect(index).toContain(`- Topic 3 (t3): ${"x".repeat(400)} → .harness/notes/n3.md`);
    expect(index).toContain("decision 1");
  });

  it("drops the oldest notes when even their titles don't fit", () => {
    const many = Array.from({ length: 40 }, (_, i) => note(i, { title: `A rather long topic title number ${i}` }));
    const index = buildNotesIndex(many, { budgetTokens: 100 });
    expect(estimateTokens(index)).toBeLessThanOrEqual(100);
    expect(index).toContain("A rather long topic title number 39");
    expect(index).not.toContain("A rather long topic title number 0 ");
    expect(index).toMatch(/- … \d+ older notes in \.harness\/notes\//);
  });

  it("shows the action even when a note has no summary", () => {
    expect(buildNotesIndex([note(1, { summary: [] })])).toContain("- Topic 1 (t1) → .harness/notes/n1.md");
  });

  it("drops summaries before decisions when collapsing", () => {
    const long = (i: number) => note(i, { summary: ["x".repeat(900)], decisions: [`decision ${i} ${"d".repeat(40)}`] });
    const index = buildNotesIndex([long(1), long(2), long(3)], { budgetTokens: 200 });
    expect(estimateTokens(index)).toBeLessThanOrEqual(200);
    expect(index).not.toContain("xxxx");
    for (const i of [1, 2, 3]) expect(index).toContain(`decision ${i}`);
    expect(index).toContain("- Topic 1 (t1) → .harness/notes/n1.md");
  });

  it("truncates the title of the last note left to respect the budget", () => {
    const index = buildNotesIndex([note(1, { title: "T".repeat(2000) }), note(0)], { budgetTokens: 80 });
    expect(estimateTokens(index)).toBeLessThanOrEqual(80);
    expect(index).toContain("TTT");
    expect(index).toContain("→ .harness/notes/n1.md");
  });

  it("stays within about 1,500 tokens by default", () => {
    const many = Array.from({ length: 60 }, (_, i) => note(i, { summary: ["y".repeat(300)] }));
    expect(estimateTokens(buildNotesIndex(many))).toBeLessThanOrEqual(1500);
  });

  it("takes its own headings and footer, and names the notes' own folder", () => {
    const scoped = (i: number) => note(i, { path: `.harness/notes/_app/n${i}.md`, title: `A rather long topic title number ${i}` });
    const index = buildNotesIndex(Array.from({ length: 40 }, (_, i) => scoped(i)), {
      budgetTokens: 120,
      heading: "## App-wide notes",
      decisionsHeading: "## App-wide decisions",
      footer: null,
    });
    expect(index.startsWith("## App-wide notes\n")).toBe(true);
    expect(index).toMatch(/- … \d+ older notes in \.harness\/notes\/_app\//);
    expect(index).not.toContain("Open a note with your read tool");
    expect(buildNotesIndex([note(1)], { decisionsHeading: "## App-wide decisions", footer: null })).toBe(
      ["## What we already covered", "- Topic 1 (t1): point 1a; point 1b → .harness/notes/n1.md", "", "## App-wide decisions", "- decision 1"].join("\n"),
    );
  });
});
