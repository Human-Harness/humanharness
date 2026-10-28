import { describe, expect, it } from "vitest";
import type { FileChange } from "@humanharness/workspace";
import { MAX_CARDS, MAX_CARD_TEXT, turnDocuments } from "../src/documents";

const history = (changes: FileChange[], files: Record<string, string>) => ({
  changes: async () => changes,
  readFileAt: async (_sha: string | null, file: string) => files[file] ?? null,
});

describe("turnDocuments (document-reader §5.1)", () => {
  it("an added .md is new, a changed one updated; title, kind and words from the turn's commit", async () => {
    const cards = await turnDocuments(
      history(
        [
          { path: "tickets/MUS-412/analysis.md", kind: "added" },
          { path: "README.md", kind: "modified" },
        ],
        { "tickets/MUS-412/analysis.md": "---\ntitle: Analysis\nkind: analysis\n---\nOne two three", "README.md": "# Read me\nHi" },
      ),
      "before",
      "after",
    );
    expect(cards).toEqual([
      { path: "README.md", title: "Read me", change: "updated", words: 4 },
      { path: "tickets/MUS-412/analysis.md", title: "Analysis", kind: "analysis", change: "new", words: 3 },
    ]);
  });

  it("no card for a non-.md file, a deleted .md, anything under .harness/, or a file it cannot read", async () => {
    const cards = await turnDocuments(
      history(
        [
          { path: "src/a.ts", kind: "added" },
          { path: "old.md", kind: "deleted" },
          { path: ".harness/notes/x.md", kind: "added" },
          { path: "Notes.MD", kind: "added" },
          { path: "gone.md", kind: "added" },
          { path: "a\\b.md", kind: "added" },
          { path: "C:x.md", kind: "added" },
          { path: `${"d/".repeat(600)}x.md`, kind: "added" },
        ],
        { "Notes.MD": "x" },
      ),
      "b",
      "a",
    );
    expect(cards.map((c) => c.path)).toEqual(["Notes.MD"]);
  });

  it("at most MAX_CARDS, in path order", async () => {
    const changes = Array.from({ length: MAX_CARDS + 5 }, (_, i) => ({ path: `d/${String(i).padStart(2, "0")}.md`, kind: "added" as const }));
    const files = Object.fromEntries(changes.map((c) => [c.path, "x"]));
    const cards = await turnDocuments(history(changes.reverse(), files), "b", "a");
    expect(cards).toHaveLength(MAX_CARDS);
    expect(cards[0].path).toBe("d/00.md");
  });

  it("reads at most MAX_CARD_TEXT of a document, fast, whatever its size", async () => {
    const huge = `---\ntitle: Big\n---\n${"word ".repeat(2_000_000)}`;
    const started = Date.now();
    const [card] = await turnDocuments(history([{ path: "big.md", kind: "added" }], { "big.md": huge }), "b", "a");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(card.title).toBe("Big");
    expect(card.words).toBeGreaterThan(200_000);
    expect(card.words).toBeLessThanOrEqual(MAX_CARD_TEXT / 5);
  });
});
