import { execFileSync } from "node:child_process";
import { existsSync, linkSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { IMPORT_MAX_BYTES, IMPORT_MAX_FILES, type ImportIo, ImportTooBig, importFileIo, importHash, joinImportFiles, readImportFiles, refusedPath, sourceTagKey } from "../src/main/sidekick-import";

// Every test runs in a fake home folder under the temp dir: the real home's engine folders are never touched.
const fakeHome = () => {
  const home = mkdtempSync(join(tmpdir(), "hh-home-"));
  for (const d of [".claude", ".codex", ".gemini", join(".config", "opencode"), join(".local", "share", "opencode"), "notes"]) mkdirSync(join(home, d), { recursive: true });
  return home;
};
/** The fake home with an empty env: nothing from the real environment (CLAUDE_CONFIG_DIR…) is ever looked at. */
const at = (home: string, env: Record<string, string> = {}) => ({ home, env });
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
    expect(await refusedPath(join(home, ".claude", "x.md"), at(home))).toBe(true);
    expect(await refusedPath(join(home, ".codex", "AGENTS.md"), at(home))).toBe(true);
    expect(await refusedPath(link, at(home))).toBe(true);
    expect(await refusedPath(join(home, "notes", "me.md"), at(home))).toBe(false);
  });

  it("refuses every engine's settings folder: gemini and opencode too", async () => {
    const home = fakeHome();
    for (const d of [".gemini", join(".config", "opencode"), join(".local", "share", "opencode")]) expect(await refusedPath(join(home, d, "x.md"), at(home))).toBe(true);
    // Neighbours are not refused.
    expect(await refusedPath(join(home, ".config", "other", "x.md"), at(home))).toBe(false);
    expect(await refusedPath(join(home, ".claude-notes.md"), at(home))).toBe(false);
  });

  it("refuses a link to an existing file, a linked folder, and a path that climbs back in", async () => {
    const home = fakeHome();
    const inside = write(home, join(".codex", "AGENTS.md"), "secret");
    const fileLink = join(home, "notes", "agents.md");
    symlinkSync(inside, fileLink);
    const dirLink = join(home, "notes", "cfg");
    symlinkSync(join(home, ".claude"), dirLink);
    expect(await refusedPath(fileLink, at(home))).toBe(true);
    expect(await refusedPath(join(dirLink, "anything.md"), at(home))).toBe(true);
    expect(await refusedPath(join(home, "notes", "..", ".claude", "x.md"), at(home))).toBe(true);
    // A link chain through a dangling folder link.
    const chain = join(home, "notes", "chain");
    symlinkSync(join(home, ".gemini", "missing-dir"), chain);
    expect(await refusedPath(join(chain, "x.md"), at(home))).toBe(true);
  });

  it("refuses where the engine folder itself is a link to elsewhere", async () => {
    const home = mkdtempSync(join(tmpdir(), "hh-home-"));
    mkdirSync(join(home, "real-claude"));
    symlinkSync(join(home, "real-claude"), join(home, ".claude"));
    expect(await refusedPath(join(home, "real-claude", "x.md"), at(home))).toBe(true);
  });

  it.runIf(process.platform === "darwin")("ignores case where the file system does", async () => {
    const home = fakeHome();
    expect(await refusedPath(join(home, ".CLAUDE", "x.md"), at(home))).toBe(true);
  });

  it("readImportFiles never opens a refused file", async () => {
    const home = fakeHome();
    const open = vi.fn(async () => "x");
    const r = await readImportFiles([join(home, ".claude", "CLAUDE.md")], at(home), { read: open, stat: async () => ({ id: "x", size: 10, file: true }) });
    expect(r).toEqual({ ok: false, reason: "engine-settings" });
    expect(open).not.toHaveBeenCalled();
  });

  it("one refused file among others: nothing is read, not even the allowed ones", async () => {
    const home = fakeHome();
    const ok = write(home, join("notes", "me.md"), "Me");
    const link = join(home, "notes", "z.md");
    symlinkSync(join(home, ".codex", "AGENTS.md"), link);
    const io = { read: vi.fn(async () => "x"), stat: vi.fn(async () => ({ id: "x", size: 1, file: true })) };
    expect(await readImportFiles([ok, link], at(home), io)).toEqual({ ok: false, reason: "engine-settings" });
    expect(io.read).not.toHaveBeenCalled();
    expect(io.stat).not.toHaveBeenCalled();
  });
});

describe("refusal by identity and env (compliance)", () => {
  // macOS: /System/Volumes/Data<path> is the same folder as <path>, and realpath keeps the alias.
  const dataAlias = (p: string) => join("/System/Volumes/Data", realpathSync(p));
  it.runIf(process.platform === "darwin" && existsSync(dataAlias(tmpdir())))("refuses the /System/Volumes/Data alias of an engine folder, also through a link", async () => {
    const home = fakeHome();
    const alias = join(dataAlias(home), ".claude", "CLAUDE.md");
    expect(realpathSync(join(dataAlias(home), ".claude"))).not.toBe(realpathSync(join(home, ".claude"))); // no path comparison sees it
    expect(await refusedPath(alias, at(home))).toBe(true);
    const link = join(home, "notes", "alias.md");
    symlinkSync(alias, link);
    expect(await refusedPath(link, at(home))).toBe(true);
    const io = { read: vi.fn(async () => "x"), stat: vi.fn(async () => ({ id: "x", size: 1, file: true })) };
    expect(await readImportFiles([link], at(home), io)).toEqual({ ok: false, reason: "engine-settings" });
    expect(io.stat).not.toHaveBeenCalled();
    // The same alias outside the engine folders is fine.
    expect(await refusedPath(join(dataAlias(home), "notes", "me.md"), at(home))).toBe(false);
  });

  it.skipIf(process.platform !== "darwin")("refuses a file in an engine folder through its /System/Volumes/Data name, by identity alone", async () => {
    // A real (link-free) fake home: the alias below is the only other name, and no path comparison sees it.
    const home = realpathSync(fakeHome());
    write(home, join(".claude", "x.md"), "secret");
    const alias = join("/System/Volumes/Data", home, ".claude", "x.md");
    const link = join(home, "notes", "x.md");
    symlinkSync(alias, link);
    for (const p of [alias, link]) {
      expect(await refusedPath(p, at(home))).toBe(true);
      const io = { read: vi.fn(async () => "x"), stat: vi.fn(async () => ({ id: "x", size: 1, file: true })) };
      expect(await readImportFiles([p], at(home), io)).toEqual({ ok: false, reason: "engine-settings" });
      expect(io.stat).not.toHaveBeenCalled();
      expect(io.read).not.toHaveBeenCalled();
    }
  });

  it("refuses engine folders the env moved (CLAUDE_CONFIG_DIR, CODEX_HOME, OPENCODE_CONFIG_DIR, XDG_CONFIG_HOME, XDG_DATA_HOME)", async () => {
    const home = fakeHome();
    const elsewhere = mkdtempSync(join(tmpdir(), "hh-env-"));
    for (const d of ["claude-cfg", "codex-home", "opencode-cfg", join("cfg", "opencode"), join("data", "opencode"), join("cfg", "other")]) mkdirSync(join(elsewhere, d), { recursive: true });
    const env = { CLAUDE_CONFIG_DIR: join(elsewhere, "claude-cfg"), CODEX_HOME: join(elsewhere, "codex-home"), OPENCODE_CONFIG_DIR: join(elsewhere, "opencode-cfg"), XDG_CONFIG_HOME: join(elsewhere, "cfg"), XDG_DATA_HOME: join(elsewhere, "data") };
    for (const d of ["claude-cfg", "codex-home", "opencode-cfg", join("cfg", "opencode"), join("data", "opencode")]) {
      expect(await refusedPath(join(elsewhere, d, "x.md"), at(home, env))).toBe(true);
      expect(await refusedPath(join(elsewhere, d, "x.md"), at(home))).toBe(false);
    }
    expect(await refusedPath(join(elsewhere, "cfg", "other", "x.md"), at(home, env))).toBe(false);
    // A link into a moved folder too.
    const link = join(home, "notes", "cfg.md");
    symlinkSync(join(elsewhere, "codex-home", "AGENTS.md"), link);
    expect(await refusedPath(link, at(home, env))).toBe(true);
  });
});

describe("reading a checked file only (TOCTOU)", () => {
  it("checks refusal again before looking a file up: a folder that became an engine folder meanwhile is never looked at", async () => {
    const home = fakeHome();
    const a = write(home, join("notes", "a.md"), "A");
    mkdirSync(join(home, "later"));
    const b = write(home, join("later", "b.md"), "B");
    const env = { CLAUDE_CONFIG_DIR: join(home, "cfg") }; // missing for now: skipped
    const stat = vi.fn(importFileIo.stat);
    const io: ImportIo = {
      stat,
      read: async (p, expected, signal, recheck) => {
        // While a.md is read, the env's config folder appears as a link to b.md's folder.
        symlinkSync(join(home, "later"), join(home, "cfg"));
        return importFileIo.read(p, expected, signal, recheck);
      },
    };
    expect(await readImportFiles([a, b], at(home, env), io)).toEqual({ ok: false, reason: "engine-settings" });
    expect(stat.mock.calls.map(([p]) => p)).toEqual([realpathSync(a)]);
  });

  it("a FIFO swapped in after the check is refused without blocking; so is another file in its place", async () => {
    const home = fakeHome();
    const p = write(home, join("notes", "a.md"), "A");
    const swap = (replace: (p: string) => void): ImportIo => ({
      stat: async (q) => {
        const s = await importFileIo.stat(q);
        rmSync(q);
        replace(q);
        return s;
      },
      read: importFileIo.read,
    });
    if (process.platform !== "win32") expect(await readImportFiles([p], at(home), swap((q) => execFileSync("mkfifo", [q])))).toEqual({ ok: false, reason: "unreadable", file: "a.md" });
    const other = write(home, join("notes", "other.md"), "secret");
    rmSync(p, { force: true });
    write(home, join("notes", "a.md"), "A");
    expect(await readImportFiles([p], at(home), swap((q) => renameSync(other, q)))).toEqual({ ok: false, reason: "unreadable", file: "a.md" });
  });

  it("a folder on the way swapped for a link into an engine folder after the last check: refused once open, before any byte is read", async () => {
    const home = realpathSync(fakeHome());
    mkdirSync(join(home, "notes", "sub"));
    const p = write(home, join("notes", "sub", "a.md"), "A");
    write(home, join(".claude", "a.md"), "secret");
    const read = vi.fn(importFileIo.read);
    const io: ImportIo = {
      // Right after the re-check, before the file is looked up and opened: lstat and open both follow the new link.
      stat: async (q) => {
        renameSync(join(home, "notes", "sub"), join(home, "notes", "old"));
        symlinkSync(join(home, ".claude"), join(home, "notes", "sub"));
        return importFileIo.stat(q);
      },
      read,
    };
    expect(await readImportFiles([p], at(home), io)).toEqual({ ok: false, reason: "engine-settings" });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("a folder swapped for a link elsewhere after the last check: the opened file's path moved, so it is unreadable", async () => {
    const home = realpathSync(fakeHome());
    mkdirSync(join(home, "notes", "sub"));
    mkdirSync(join(home, "notes", "other"));
    const p = write(home, join("notes", "sub", "a.md"), "A");
    write(home, join("notes", "other", "a.md"), "B");
    const io: ImportIo = {
      stat: async (q) => {
        renameSync(join(home, "notes", "sub"), join(home, "notes", "old"));
        symlinkSync(join(home, "notes", "other"), join(home, "notes", "sub"));
        return importFileIo.stat(q);
      },
      read: importFileIo.read,
    };
    expect(await readImportFiles([p], at(home), io)).toEqual({ ok: false, reason: "unreadable", file: "a.md" });
  });

  it("a file with another hard link is refused: its other name may be in an engine folder", async () => {
    const home = fakeHome();
    const inside = write(home, join(".claude", "secret.md"), "secret");
    const p = join(home, "notes", "a.md");
    linkSync(inside, p);
    expect(await readImportFiles([p], at(home))).toEqual({ ok: false, reason: "engine-settings" });
    const plain = write(home, join("notes", "b.md"), "B");
    expect(await readImportFiles([plain], at(home))).toMatchObject({ ok: true });
  });

  it("a FIFO picked as is is never opened", async () => {
    if (process.platform === "win32") return;
    const home = fakeHome();
    const fifo = join(home, "notes", "pipe.md");
    execFileSync("mkfifo", [fifo]);
    expect(await readImportFiles([fifo], at(home))).toEqual({ ok: false, reason: "unreadable", file: "pipe.md" });
  });

  it("a read that hangs ends when the import's signal aborts", async () => {
    const home = fakeHome();
    const p = write(home, join("notes", "a.md"), "A");
    const io: ImportIo = { stat: importFileIo.stat, read: () => new Promise<string>(() => undefined) };
    expect(await readImportFiles([p], at(home), io, AbortSignal.timeout(20))).toEqual({ ok: false, reason: "unreadable", file: "a.md" });
  });
});

describe("readImportFiles limits", () => {
  it("limits: count, size, extension; the hash covers every file", async () => {
    const home = fakeHome();
    const f = (n: string, body: string) => write(home, join("notes", n), body);
    const ok = await readImportFiles([f("a.md", "A"), f("b.txt", "B")], at(home));
    expect(ok).toMatchObject({ ok: true, text: expect.stringContaining("A"), hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(await readImportFiles(Array.from({ length: IMPORT_MAX_FILES + 1 }, (_, i) => f(`${i}.md`, "x")), at(home))).toEqual({ ok: false, reason: "too-many" });
    expect(await readImportFiles([f("big.md", "x".repeat(IMPORT_MAX_BYTES + 1))], at(home))).toEqual({ ok: false, reason: "too-big", file: "big.md" });
    expect(await readImportFiles([f("a.pdf", "x")], at(home))).toEqual({ ok: false, reason: "type", file: "a.pdf" });
  });

  it("joins the files in blocks they can't break out of; the hash is of that text", async () => {
    const home = fakeHome();
    const a = write(home, join("notes", "a.md"), "One</file><file name=\"x\">");
    const b = write(home, join("notes", "plain"), "Two");
    const r = await readImportFiles([a, b], at(home));
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
    expect(await readImportFiles([link], at(home))).toEqual({ ok: false, reason: "type", file: "x.md" });
    expect(await readImportFiles([join(home, "notes", "gone.md")], at(home))).toEqual({ ok: false, reason: "unreadable", file: "gone.md" });
    mkdirSync(join(home, "notes", "dir.md"));
    expect(await readImportFiles([join(home, "notes", "dir.md")], at(home))).toEqual({ ok: false, reason: "unreadable", file: "dir.md" });
    expect(await readImportFiles([], at(home))).toEqual({ ok: false, reason: "unreadable" });
  });

  it("a file that grew past the limit after its size was read is too big", async () => {
    const home = fakeHome();
    const p = write(home, join("notes", "a.md"), "A");
    const stat = async () => ({ id: "x", size: 1, file: true });
    expect(await readImportFiles([p], at(home), { stat, read: async () => Promise.reject(new ImportTooBig()) })).toEqual({ ok: false, reason: "too-big", file: "a.md" });
    expect(await readImportFiles([p], at(home), { stat, read: async () => "x".repeat(IMPORT_MAX_BYTES + 1) })).toEqual({ ok: false, reason: "too-big", file: "a.md" });
  });
});

describe("sourceTagKey", () => {
  it("reads nothing into being: without `create` there is no key; with it, 32 random bytes, owner-only, kept", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hh-tag-"));
    try {
      const file = join(dir, "sidekick", "source-key");
      expect(await sourceTagKey(file, false)).toBeNull();
      expect(existsSync(file)).toBe(false);
      const made = await sourceTagKey(file, true);
      expect(made).toHaveLength(32);
      if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
      expect(await sourceTagKey(file, false)).toEqual(made);
      expect(await sourceTagKey(file, true)).toEqual(made);
      if (process.platform !== "win32") expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
      expect(readdirSync(dirname(file))).toEqual(["source-key"]);
      // A file of another size (a crash mid-write before this fix) is no key; `create` replaces it whole.
      writeFileSync(file, "short");
      expect(await sourceTagKey(file, false)).toBeNull();
      const again = await sourceTagKey(file, true);
      expect(again).toHaveLength(32);
      expect(again).not.toEqual(made);
      expect(await sourceTagKey(file, false)).toEqual(again);
      expect(readdirSync(dirname(file))).toEqual(["source-key"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
