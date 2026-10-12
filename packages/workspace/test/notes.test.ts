import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { noteSlug, parseNote, readNotes, renderNote, writeNote } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const tmp = () => fs.mkdtempSync(path.join(root, "t-"));

const note = {
  title: "A turn: end to end",
  summary: ["ui → shell → runtime", "events come back"],
  decisions: ["One session per task"],
  files: ["packages/runtime/src/runtime.ts"],
  open: [],
};
const meta = { action: "turn", date: "2026-10-12T11:20:00.000Z", engine: "claude" };

describe("writeNote", () => {
  it("writes front matter and sections, and reads them back", async () => {
    const folder = tmp();
    expect(await writeNote(folder, "turn", note, meta)).toBe(".harness/notes/turn.md");
    expect(fs.readFileSync(path.join(folder, ".harness/notes/turn.md"), "utf8")).toBe(
      [
        "---",
        'title: "A turn: end to end"',
        'action: "turn"',
        'date: "2026-10-12T11:20:00.000Z"',
        'engine: "claude"',
        'files: ["packages/runtime/src/runtime.ts"]',
        "---",
        "## Summary",
        "- ui → shell → runtime",
        "- events come back",
        "",
        "## Decisions",
        "- One session per task",
        "",
      ].join("\n"),
    );
    expect(await readNotes(folder)).toEqual([{ slug: "turn", path: ".harness/notes/turn.md", ...note, ...meta }]);
  });

  it("keeps each point on one line and writes the open questions", () => {
    const parsed = parseNote("x", renderNote({ ...note, summary: ["two\n  lines"], open: ["Who reads the archive?"] }, { date: "d", engine: "e" }));
    expect(parsed?.summary).toEqual(["two lines"]);
    expect(parsed?.open).toEqual(["Who reads the archive?"]);
    expect(parsed?.action).toBeUndefined();
  });

  it("replaces a note without leaving temp files", async () => {
    const folder = tmp();
    await writeNote(folder, "q-chats", note, { date: "d", engine: "codex" });
    await writeNote(folder, "q-chats", { ...note, title: "Second" }, { date: "d", engine: "codex" });
    expect((await readNotes(folder)).map((n) => n.title)).toEqual(["Second"]);
    expect(fs.readdirSync(path.join(folder, ".harness/notes"))).toEqual(["q-chats.md"]);
  });

  it("refuses a slug that could leave the notes folder", async () => {
    await expect(writeNote(tmp(), "../evil", note, meta)).rejects.toThrow(/slug/);
    await expect(writeNote(tmp(), "", note, meta)).rejects.toThrow(/slug/);
  });
});

describe("readNotes", () => {
  it("lists notes newest first and skips files that are not notes", async () => {
    const folder = tmp();
    await writeNote(folder, "old", { ...note, title: "Old" }, { ...meta, date: "2026-10-10T10:00:00.000Z" });
    await writeNote(folder, "new", { ...note, title: "New" }, { ...meta, date: "2026-10-12T10:00:00.000Z" });
    fs.writeFileSync(path.join(folder, ".harness/notes/broken.md"), "no front matter");
    fs.writeFileSync(path.join(folder, ".harness/notes/readme.txt"), "x");
    expect((await readNotes(folder)).map((n) => n.title)).toEqual(["New", "Old"]);
  });

  it("is empty when there is no notes folder", async () => {
    expect(await readNotes(tmp())).toEqual([]);
  });
});

describe("noteSlug", () => {
  it("makes a file-safe slug", () => {
    expect(noteSlug("¿Dónde se guarda la conversación?")).toBe("donde-se-guarda-la-conversacion");
    expect(noteSlug("!!!")).toBe("note");
    expect(noteSlug("a".repeat(100))).toHaveLength(60);
  });
});
