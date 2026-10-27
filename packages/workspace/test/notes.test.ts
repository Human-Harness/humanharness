import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { folderRelative, noteSlug, parseNote, readNotes, relativizeNoteFiles, renderNote, writeNote } from "../src";

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

  it("writes the modes a task used into the front matter; none, no line (task-modes D0)", () => {
    const text = renderNote(note, { action: "study", date: "d", engine: "claude", modes: ["socratic", "feynman"] });
    expect(text).toContain('engine: "claude"\nmodes: ["socratic","feynman"]\nfiles: ');
    expect(renderNote(note, { date: "d", engine: "claude" })).not.toContain("modes:");
    expect(parseNote("x", text)?.summary).toEqual(note.summary);
  });

  it("reads a hand-edited note: BOM, plain YAML lists and quoted values", () => {
    const text = [
      "\uFEFF---",
      "title: 'Edited by hand'",
      "action: turn",
      "date: 2026-10-12T11:20:00.000Z",
      "engine: 'claude'",
      "files: [packages/runtime/src/runtime.ts, 'docs/a b.md', \"x.md\"]",
      "---",
      "## Summary",
      "- still here",
      "",
    ].join("\r\n");
    const parsed = parseNote("edited", text);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Edited by hand");
    expect(parsed?.action).toBe("turn");
    expect(parsed?.engine).toBe("claude");
    expect(parsed?.date).toBe("2026-10-12T11:20:00.000Z");
    expect(parsed?.files).toEqual(["packages/runtime/src/runtime.ts", "docs/a b.md", "x.md"]);
    expect(parsed?.summary).toEqual(["still here"]);
    expect(parseNote("empty", "---\ntitle: x\nfiles: []\n---\n")?.files).toEqual([]);
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

describe("note files", () => {
  it("stores paths inside the folder relative to it", async () => {
    const folder = tmp();
    await writeNote(folder, "turn", { ...note, files: [path.join(folder, "plan", "week.md"), "/elsewhere/x.md", "rel.md"] }, meta);
    const [saved] = await readNotes(folder);
    expect(saved.files).toEqual(["plan/week.md", "/elsewhere/x.md", "rel.md"]);
  });

  it("makes paths into a folder relative and leaves everything else", () => {
    expect(folderRelative("/a/Work", "/a/Work/x/y.md")).toBe("x/y.md");
    expect(folderRelative("/a/Work", "/a/Workshop/y.md")).toBe("/a/Workshop/y.md");
    expect(folderRelative("/a/Work", "/a/Work")).toBe("/a/Work");
    expect(folderRelative("/a/Work", "y.md")).toBe("y.md");
    expect(folderRelative("/a/Work", "/a/Work/..notes.md")).toBe("..notes.md");
    expect(folderRelative("/a/Work", "/a/Work/..x/y.md")).toBe("..x/y.md");
    expect(folderRelative("/a/Work", "/a/other.md")).toBe("/a/other.md");
  });

  it("rewrites only the files line of notes that name the old folder", async () => {
    const folder = tmp();
    const dir = path.join(folder, ".harness/notes");
    fs.mkdirSync(dir, { recursive: true });
    const old = "/Users/me/Documents/Work";
    fs.writeFileSync(path.join(dir, "a.md"), `---\ntitle: "A"\nfiles: ["${old}/plan.md", "/other/x.md"]\n---\n## Summary\n- ${old}/plan.md stays in the text\n`);
    fs.writeFileSync(path.join(dir, "b.md"), `---\ntitle: "B"\nfiles: ["plan.md"]\n---\n`);
    fs.writeFileSync(path.join(dir, "c.md"), "no front matter\n");
    expect(await relativizeNoteFiles(folder, old)).toBe(1);
    expect(fs.readFileSync(path.join(dir, "a.md"), "utf8")).toBe(
      `---\ntitle: "A"\nfiles: ["plan.md","/other/x.md"]\n---\n## Summary\n- ${old}/plan.md stays in the text\n`,
    );
    expect(fs.readFileSync(path.join(dir, "b.md"), "utf8")).toBe(`---\ntitle: "B"\nfiles: ["plan.md"]\n---\n`);
    expect(fs.readdirSync(dir).sort()).toEqual(["a.md", "b.md", "c.md"]);
  });

  it("keeps a BOM and CRLF line ends, and finds the closing fence only on its own line", async () => {
    const folder = tmp();
    const dir = path.join(folder, ".harness/notes");
    fs.mkdirSync(dir, { recursive: true });
    const old = "/Users/me/Work";
    const text = ["\uFEFF---", 'title: "A"', `files: ["${old}/plan.md"]`, "---", "## Summary", "- x", ""].join("\r\n");
    fs.writeFileSync(path.join(dir, "a.md"), text);
    // A line that starts with "---" inside the front matter is not its end.
    const dashes = ["---", 'title: "B"', "----not the end", `files: ["${old}/b.md"]`, "---", ""].join("\n");
    fs.writeFileSync(path.join(dir, "b.md"), dashes);
    expect(await relativizeNoteFiles(folder, old)).toBe(2);
    expect(fs.readFileSync(path.join(dir, "a.md"), "utf8")).toBe(["\uFEFF---", 'title: "A"', 'files: ["plan.md"]', "---", "## Summary", "- x", ""].join("\r\n"));
    expect(fs.readFileSync(path.join(dir, "b.md"), "utf8")).toBe(["---", 'title: "B"', "----not the end", 'files: ["b.md"]', "---", ""].join("\n"));
  });

  it("skips a note it can't read and goes on with the others", async () => {
    const folder = tmp();
    const dir = path.join(folder, ".harness/notes");
    fs.mkdirSync(path.join(dir, "broken.md"), { recursive: true });
    fs.writeFileSync(path.join(dir, "ok.md"), `---\ntitle: "A"\nfiles: ["/old/a.md"]\n---\n`);
    expect(await relativizeNoteFiles(folder, "/old")).toBe(1);
    expect(fs.readFileSync(path.join(dir, "ok.md"), "utf8")).toBe(`---\ntitle: "A"\nfiles: ["a.md"]\n---\n`);
  });

  it("does nothing when there are no notes", async () => {
    expect(await relativizeNoteFiles(tmp(), "/old")).toBe(0);
  });
});

describe("notes per scope", () => {
  it("writes and reads a scope's notes in its own folder", async () => {
    const folder = tmp();
    expect(await writeNote(folder, "turn", note, meta, ".harness/notes/fracciones/")).toBe(".harness/notes/fracciones/turn.md");
    await writeNote(folder, "other", { ...note, title: "App-wide" }, meta, ".harness/notes/_app/");
    expect(await readNotes(folder, ".harness/notes/fracciones/")).toEqual([{ slug: "turn", path: ".harness/notes/fracciones/turn.md", ...note, ...meta }]);
    expect((await readNotes(folder, ".harness/notes/_app/")).map((n) => n.title)).toEqual(["App-wide"]);
    // The flat folder doesn't list a scope's folder.
    expect(await readNotes(folder)).toEqual([]);
    expect(parseNote("x", renderNote(note, meta), ".harness/notes/_app/")?.path).toBe(".harness/notes/_app/x.md");
  });

  it("refuses a notes folder outside .harness/notes/", async () => {
    await expect(writeNote(tmp(), "a", note, meta, ".harness/notes/../../x/")).rejects.toThrow(/notes folder/);
    await expect(writeNote(tmp(), "a", note, meta, "elsewhere/")).rejects.toThrow(/notes folder/);
    await expect(readNotes(tmp(), ".harness/notes/Bad/")).rejects.toThrow(/notes folder/);
  });

  it("rewrites the files line of the notes in every scope's folder after a move", async () => {
    const folder = tmp();
    const old = "/Users/me/Work";
    for (const dir of ["", "main/", "_app/"]) {
      fs.mkdirSync(path.join(folder, ".harness/notes", dir), { recursive: true });
      fs.writeFileSync(path.join(folder, ".harness/notes", dir, "a.md"), `---\ntitle: "A"\nfiles: ["${old}/plan.md"]\n---\n`);
    }
    fs.mkdirSync(path.join(folder, ".harness/notes/Not-a-scope"), { recursive: true });
    fs.writeFileSync(path.join(folder, ".harness/notes/Not-a-scope/a.md"), `---\ntitle: "A"\nfiles: ["${old}/plan.md"]\n---\n`);
    expect(await relativizeNoteFiles(folder, old)).toBe(3);
    expect(fs.readFileSync(path.join(folder, ".harness/notes/_app/a.md"), "utf8")).toContain('files: ["plan.md"]');
    expect(fs.readFileSync(path.join(folder, ".harness/notes/Not-a-scope/a.md"), "utf8")).toContain(`${old}/plan.md`);
  });
});
