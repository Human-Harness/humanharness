import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { MAX_EDITS, TurnLedger } from "../src/turn-ledger";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-ledger-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("TurnLedger (parallel spec §5.2, T3)", () => {
  it("a window alone stays not overlapped; a second one marks both", () => {
    const l = new TurnLedger(["/w"]);
    const a = l.open("A", "t1");
    expect(a.alone).toBe(true);
    expect(a.overlapped).toBe(false);
    const b = l.open("B", "t2");
    expect(b.alone).toBe(false);
    expect(a.overlapped && b.overlapped).toBe(true);
    expect(l.running().map((w) => w.key)).toEqual(["A", "B"]);
    expect(l.close("A").map((w) => w.key)).toEqual(["B"]);
    expect(l.anyRunning()).toBe(true);
    l.close("B");
    expect(l.anyRunning()).toBe(false);
    const c = l.open("C");
    expect(c.alone).toBe(true);
    expect(c.overlapped).toBe(false);
  });

  it("a window's edits stop growing at MAX_EDITS", () => {
    const l = new TurnLedger(["/w"]);
    const w = l.open("A", "t1");
    l.noteEdits("A", Array.from({ length: MAX_EDITS + 5 }, (_, i) => `/w/f${i}.md`));
    expect(w.edits.size).toBe(MAX_EDITS);
    expect(w.edits.has("f0.md")).toBe(true);
    expect(w.edits.has(`f${MAX_EDITS}.md`)).toBe(false);
    l.noteEdits("A", ["/w/late.md"]);
    expect(w.edits.size).toBe(MAX_EDITS);
  });

  it("wrote: only the paths of an edit that ended without an error, by its id; a closed window forgets the rest", () => {
    const l = new TurnLedger(["/w"]);
    const w = l.open("A", "t1");
    l.noteEdits("A", ["/w/ok.md", "/outside/x.md"], "e1");
    l.noteEdits("A", ["/w/denied.md"], "e2");
    l.noteEdits("A", ["/w/open.md"], "e3");
    expect([...w.edits].sort()).toEqual(["denied.md", "ok.md", "open.md"]);
    expect(w.wrote.size).toBe(0);
    l.noteEditEnd("A", "e1", false);
    l.noteEditEnd("A", "e2", true);
    l.noteEditEnd("A", "unknown", false);
    l.noteEditEnd("B", "e3", false);
    expect([...w.wrote]).toEqual(["ok.md"]);
    // An id ends once.
    l.noteEditEnd("A", "e2", false);
    expect([...w.wrote]).toEqual(["ok.md"]);
    l.close("A");
    l.noteEditEnd("A", "e3", false);
    expect([...w.wrote]).toEqual(["ok.md"]);
  });

  it("a key can't hold two windows", () => {
    const l = new TurnLedger(["/w"]);
    l.open("A");
    expect(() => l.open("A")).toThrow("already");
  });

  it("edits: folder-relative with forward slashes; the real path counts; outsiders and .. dropped (PT-S1)", () => {
    const l = new TurnLedger(["/w", "/private/w"]);
    const a = l.open("A");
    l.noteEdits("A", ["/w/a.md", "/private/w/sub/b.md", "rel/c.md", "/etc/passwd", "/w/../x", "/w", "/private/w", "../w2/y.md", "/w2/z.md"]);
    expect([...a.edits].sort()).toEqual(["a.md", "rel/c.md", "sub/b.md"]);
    // A key with no open window: nothing happens, nothing throws.
    l.noteEdits("nobody", ["/w/z.md"]);
    expect([...a.edits]).not.toContain("z.md");
  });

  it("a name git couldn't track by that spelling is dropped", () => {
    const l = new TurnLedger(["/w"]);
    const a = l.open("A");
    l.noteEdits("A", ["/w/back\\slash.md", "/w/sub/./ok.md", "/w/sub//two.md"]);
    // resolve() already folds `.` and `//`; a backslash stays and is refused.
    expect([...a.edits].sort()).toEqual(["sub/ok.md", "sub/two.md"]);
  });

  it("a folder reached through a link: the given form (Codex) and the real form (Claude) name the same path", () => {
    const real = path.join(root, "real");
    fs.mkdirSync(path.join(real, "sub"), { recursive: true });
    const link = path.join(root, "link");
    fs.symlinkSync(real, link);
    const l = TurnLedger.forFolder(link);
    const a = l.open("A");
    const realForm = fs.realpathSync(link);
    expect(realForm).not.toBe(link);
    l.noteEdits("A", [path.join(link, "a.md"), path.join(realForm, "a.md"), path.join(realForm, "sub", "b.md")]);
    // Outside both forms: the link's own parent and a sibling folder.
    l.noteEdits("A", [path.join(root, "x.md"), path.join(root, "other", "y.md"), path.join(link, "..", "z.md")]);
    expect([...a.edits].sort()).toEqual(["a.md", "sub/b.md"]);
  });

  it("a folder with no link: forFolder keeps a single root", () => {
    const plain = fs.realpathSync(fs.mkdtempSync(path.join(root, "plain-")));
    const l = TurnLedger.forFolder(plain);
    const a = l.open("A");
    l.noteEdits("A", [path.join(plain, "a.md"), "/etc/hosts"]);
    expect([...a.edits]).toEqual(["a.md"]);
  });

  it("edit names are kept in NFC: an NFD report and an NFC one are the same path", () => {
    const l = new TurnLedger(["/w"]);
    const a = l.open("A");
    l.noteEdits("A", ["/w/café.md", "/w/café.md"]);
    expect([...a.edits]).toEqual(["café.md"]);
  });

  it("a folder named in NFD still takes edits reported in NFC (and the reverse)", () => {
    const nfdFolder = path.join(fs.realpathSync(root), "cafe\u0301");
    fs.mkdirSync(nfdFolder);
    const l = TurnLedger.forFolder(nfdFolder);
    const a = l.open("A");
    l.noteEdits("A", [path.join(fs.realpathSync(root), "caf\u00e9", "a.md"), path.join(nfdFolder, "b.md")]);
    expect([...a.edits].sort()).toEqual(["a.md", "b.md"]);
    const n = new TurnLedger(["/w/caf\u00e9"]);
    const b = n.open("B");
    n.noteEdits("B", ["/w/cafe\u0301/x.md"]);
    expect([...b.edits]).toEqual(["x.md"]);
  });
});
