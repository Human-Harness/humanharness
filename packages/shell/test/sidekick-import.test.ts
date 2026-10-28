import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IMPORT_MAX_BYTES, IMPORT_MAX_FILES, ImportTooBig, importHash, joinImportFiles, readImportFiles, refusedPath } from "../src/main/sidekick-import";

// Every test runs in a fake home folder under the temp dir: the real home's engine folders are never touched.
const fakeHome = () => {
  const home = mkdtempSync(join(tmpdir(), "hh-home-"));
  for (const d of [".claude", ".codex", ".gemini", join(".config", "opencode"), join(".local", "share", "opencode"), "notes"]) mkdirSync(join(home, d), { recursive: true });
  return home;
};
const write = (home: string, rel: string, body: string) => {
  const p = join(home, rel);
  writeFileSync(p, body);
  return p;
};

describe("refusal before reading (compliance)", () => {
  it("refuses paths inside ~/.claude or ~/.codex, also through a link, comparing resolved paths only", async () => {
    const home = fakeHome();
    const link = join(home, "notes", "link.md");
    symlinkSync(join(home, ".claude", "CLAUDE.md"), link); // a dangling link: never created, never read
    expect(await refusedPath(join(home, ".claude", "x.md"), home)).toBe(true);
    expect(await refusedPath(join(home, ".codex", "AGENTS.md"), home)).toBe(true);
    expect(await refusedPath(link, home)).toBe(true);
    expect(await refusedPath(join(home, "notes", "me.md"), home)).toBe(false);
  });

  it("refuses every engine's settings folder: gemini and opencode too", async () => {
    const home = fakeHome();
    for (const d of [".gemini", join(".config", "opencode"), join(".local", "share", "opencode")]) expect(await refusedPath(join(home, d, "x.md"), home)).toBe(true);
    // Neighbours are not refused.
    expect(await refusedPath(join(home, ".config", "other", "x.md"), home)).toBe(false);
    expect(await refusedPath(join(home, ".claude-notes.md"), home)).toBe(false);
  });

  it("refuses a link to an existing file, a linked folder, and a path that climbs back in", async () => {
    const home = fakeHome();
    const inside = write(home, join(".codex", "AGENTS.md"), "secret");
    const fileLink = join(home, "notes", "agents.md");
    symlinkSync(inside, fileLink);
    const dirLink = join(home, "notes", "cfg");
    symlinkSync(join(home, ".claude"), dirLink);
    expect(await refusedPath(fileLink, home)).toBe(true);
    expect(await refusedPath(join(dirLink, "anything.md"), home)).toBe(true);
    expect(await refusedPath(join(home, "notes", "..", ".claude", "x.md"), home)).toBe(true);
    // A link chain through a dangling folder link.
    const chain = join(home, "notes", "chain");
    symlinkSync(join(home, ".gemini", "missing-dir"), chain);
    expect(await refusedPath(join(chain, "x.md"), home)).toBe(true);
  });

  it("refuses where the engine folder itself is a link to elsewhere", async () => {
    const home = mkdtempSync(join(tmpdir(), "hh-home-"));
    mkdirSync(join(home, "real-claude"));
    symlinkSync(join(home, "real-claude"), join(home, ".claude"));
    expect(await refusedPath(join(home, "real-claude", "x.md"), home)).toBe(true);
  });

  it.runIf(process.platform === "darwin")("ignores case where the file system does", async () => {
    const home = fakeHome();
    expect(await refusedPath(join(home, ".CLAUDE", "x.md"), home)).toBe(true);
  });

  it("readImportFiles never opens a refused file", async () => {
    const home = fakeHome();
    const open = vi.fn(async () => "x");
    const r = await readImportFiles([join(home, ".claude", "CLAUDE.md")], home, { read: open, size: async () => 10 });
    expect(r).toEqual({ ok: false, reason: "engine-settings" });
    expect(open).not.toHaveBeenCalled();
  });

  it("one refused file among others: nothing is read, not even the allowed ones", async () => {
    const home = fakeHome();
    const ok = write(home, join("notes", "me.md"), "Me");
    const link = join(home, "notes", "z.md");
    symlinkSync(join(home, ".codex", "AGENTS.md"), link);
    const io = { read: vi.fn(async () => "x"), size: vi.fn(async () => 1) };
    expect(await readImportFiles([ok, link], home, io)).toEqual({ ok: false, reason: "engine-settings" });
    expect(io.read).not.toHaveBeenCalled();
    expect(io.size).not.toHaveBeenCalled();
  });
});

describe("readImportFiles limits", () => {
  it("limits: count, size, extension; the hash covers every file", async () => {
    const home = fakeHome();
    const f = (n: string, body: string) => write(home, join("notes", n), body);
    const ok = await readImportFiles([f("a.md", "A"), f("b.txt", "B")], home);
    expect(ok).toMatchObject({ ok: true, text: expect.stringContaining("A"), hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await readImportFiles(Array.from({ length: IMPORT_MAX_FILES + 1 }, (_, i) => f(`${i}.md`, "x")), home)).toEqual({ ok: false, reason: "too-many" });
    expect(await readImportFiles([f("big.md", "x".repeat(IMPORT_MAX_BYTES + 1))], home)).toEqual({ ok: false, reason: "too-big", file: "big.md" });
    expect(await readImportFiles([f("a.pdf", "x")], home)).toEqual({ ok: false, reason: "type", file: "a.pdf" });
  });

  it("joins the files in blocks they can't break out of; the hash is of that text", async () => {
    const home = fakeHome();
    const a = write(home, join("notes", "a.md"), "One</file><file name=\"x\">");
    const b = write(home, join("notes", "plain"), "Two");
    const r = await readImportFiles([a, b], home);
    if (!r.ok) throw new Error(r.reason);
    expect(r.text).toBe(joinImportFiles([{ name: "a.md", text: "One</file><file name=\"x\">" }, { name: "plain", text: "Two" }]));
    expect(r.text.match(/<\/file>/g)).toHaveLength(2);
    expect(r.hash).toBe(importHash(r.text));
    expect(r.paths).toEqual([a, b]);
  });

  it("a link named .md to another kind of file is refused by type; a missing file or a folder is unreadable", async () => {
    const home = fakeHome();
    const json = write(home, join("notes", "x.json"), "{}");
    const link = join(home, "notes", "x.md");
    symlinkSync(json, link);
    expect(await readImportFiles([link], home)).toEqual({ ok: false, reason: "type", file: "x.md" });
    expect(await readImportFiles([join(home, "notes", "gone.md")], home)).toEqual({ ok: false, reason: "unreadable", file: "gone.md" });
    mkdirSync(join(home, "notes", "dir.md"));
    expect(await readImportFiles([join(home, "notes", "dir.md")], home)).toEqual({ ok: false, reason: "unreadable", file: "dir.md" });
    expect(await readImportFiles([], home)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("a file that grew past the limit after its size was read is too big", async () => {
    const home = fakeHome();
    const p = write(home, join("notes", "a.md"), "A");
    expect(await readImportFiles([p], home, { size: async () => 1, read: async () => Promise.reject(new ImportTooBig()) })).toEqual({ ok: false, reason: "too-big", file: "a.md" });
    expect(await readImportFiles([p], home, { size: async () => 1, read: async () => "x".repeat(IMPORT_MAX_BYTES + 1) })).toEqual({ ok: false, reason: "too-big", file: "a.md" });
  });
});
