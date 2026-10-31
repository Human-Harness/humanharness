import { describe, expect, it, vi } from "vitest";
import { APP_INDEX_TOKENS } from "@humanharness/policies";
import type { Note } from "@humanharness/workspace";
import { notesIndexParts } from "../src/main/notes-index";

const note = (scope: string, i: number): Note => ({
  slug: `${scope}-${i}`,
  path: `.harness/scopes/${scope}/notes/${scope}-${i}.md`,
  title: `${scope} note number ${i} with a longer title`,
  date: `2026-10-${String(10 + (i % 18)).padStart(2, "0")}T10:00:00.000Z`,
  engine: "claude",
  summary: [`what note ${i} says, in a sentence that takes some room in the index`],
  decisions: [`decision ${i}`],
  files: [],
  open: [],
});
const notes = vi.fn(async (scope?: string) => Array.from({ length: 30 }, (_, i) => note(scope ?? "flat", i)));

describe("notesIndexParts: the app-wide budget is the caller's (replaceable-parts §7.1)", () => {
  it("no budget passed: DefaultContextPolicy's APP_INDEX_TOKENS, as before", async () => {
    const plain = await notesIndexParts(notes, true, "intro");
    const explicit = await notesIndexParts(notes, true, "intro", undefined, APP_INDEX_TOKENS);
    expect(explicit.app?.index).toBe(plain.app?.index);
  });

  it("a 100-token budget trims the app-wide index further", async () => {
    const plain = await notesIndexParts(notes, true, "intro");
    const tight = await notesIndexParts(notes, true, "intro", undefined, 100);
    expect(tight.app!.index.length).toBeLessThan(plain.app!.index.length);
    expect(tight.own.index).toBe(plain.own.index);
  });

  it("null: no app-wide index, and its notes are not read", async () => {
    notes.mockClear();
    const r = await notesIndexParts(notes, true, "intro", undefined, null);
    expect(r.app).toBeNull();
    expect(notes.mock.calls.map((c) => c[0])).toEqual(["intro"]);
  });
});

describe("notesIndexParts: the scope's own index left out", () => {
  it("own false: its notes are not read, and the app-wide index keeps its footer as when it stands alone", async () => {
    notes.mockClear();
    const alone = await notesIndexParts(notes, true, "intro", undefined, APP_INDEX_TOKENS, false);
    expect(alone.own).toEqual({ index: "", notes: [] });
    expect(notes.mock.calls.map((c) => c[0])).toEqual(["_app"]);
    const empty = await notesIndexParts(async (s) => (s === "_app" ? notes(s) : []), true, "intro");
    expect(alone.app?.index).toBe(empty.app?.index);
  });
});
