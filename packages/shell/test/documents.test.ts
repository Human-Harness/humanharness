import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { DocumentWatchers, MAX_DOCUMENT_BYTES, MAX_IMAGE_BYTES, documentsExist, locate, readDocument, readImage, refusedShape } from "../src/main/documents";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-docs-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const folder = path.join(root, "work");
const ref = path.join(root, "ref");
const outside = path.join(root, "outside");
for (const d of [path.join(folder, "docs"), path.join(ref, "guides"), outside]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(folder, "docs", "plan.md"), "# Plan\n");
fs.writeFileSync(path.join(folder, "docs", "long.markdown"), "# Long\n");
fs.writeFileSync(path.join(folder, "docs", "notes.txt"), "x");
fs.writeFileSync(path.join(ref, "guides", "style.md"), "# Style\n");
fs.writeFileSync(path.join(outside, "secret.md"), "secret");
fs.writeFileSync(path.join(outside, "secret.png"), Buffer.from([1, 2, 3]));
fs.writeFileSync(path.join(folder, "docs", "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
fs.writeFileSync(path.join(folder, "docs", "pic.JPG"), Buffer.from([0xff, 0xd8]));
fs.writeFileSync(path.join(folder, "docs", "pic.svg"), "<svg/>");
fs.symlinkSync(path.join(outside, "secret.md"), path.join(folder, "docs", "link.md"));
fs.symlinkSync(path.join(outside, "secret.png"), path.join(folder, "docs", "link.png"));
fs.symlinkSync(path.join(folder, "docs", "notes.txt"), path.join(folder, "docs", "disguised.md"));
const roots = [folder, ref];

/** Shapes refused before any file system call (T7 review: "TASK 10 MUST"). */
const badShapes: [string, unknown][] = [
  ["not a string", 42],
  ["empty", ""],
  ["too long", `${"x".repeat(1000)}.md`],
  ["NUL", "docs/a\0b.md"],
  ["absolute POSIX", path.join(outside, "secret.md")],
  ["absolute root", "/etc/hosts.md"],
  ["leading ../", "../outside/secret.md"],
  ["just ..", ".."],
  ["leading ./../", "./../outside/secret.md"],
  ["//host", "//host/share/a.md"],
  ["UNC", "\\\\host\\share\\a.md"],
  ["backslash", "docs\\plan.md"],
  ["drive letter", "C:/Users/a.md"],
  ["drive-relative", "C:a.md"],
];

describe("refusedShape", () => {
  it.each(badShapes)("refuses %s", (_name, rel) => {
    expect(refusedShape(rel)).toBe(true);
  });
  it("takes plain relative paths, also with a leading ./ or a .. that stays inside", () => {
    for (const rel of ["docs/plan.md", "./docs/plan.md", "docs/../docs/plan.md", "a..b.md", "..hidden.md"]) expect(refusedShape(rel)).toBe(false);
  });
});

describe("refusals touch no file", () => {
  it.each(badShapes)("%s: locate, readDocument, readImage, documentsExist, watch", async (_name, rel) => {
    const spies = (["realpath", "stat", "lstat", "readFile", "open"] as const).map((m) => vi.spyOn(fs.promises, m));
    const watchSpy = vi.spyOn(fs, "watch");
    try {
      expect(await locate(rel, roots)).toEqual({ ok: false, reason: "outside" });
      expect(await readDocument(rel, roots)).toEqual({ ok: false, reason: "outside" });
      expect(await readImage(rel, roots)).toBeNull();
      expect(await documentsExist([rel], roots)).toEqual([false]);
      expect(await new DocumentWatchers(() => {}, 50).watch(rel, roots)).toBeNull();
      for (const s of spies) expect(s).not.toHaveBeenCalled();
      expect(watchSpy).not.toHaveBeenCalled();
    } finally {
      for (const s of spies) s.mockRestore();
      watchSpy.mockRestore();
    }
  });
});

describe("locate", () => {
  it("finds a file in the folder or a reference folder", async () => {
    expect(await locate("docs/plan.md", roots)).toEqual({ ok: true, file: path.join(folder, "docs", "plan.md"), root: folder });
    expect(await locate("guides/style.md", roots)).toMatchObject({ ok: true, root: ref });
  });
  it("tells a missing file from one outside the folder", async () => {
    expect(await locate("docs/gone.md", roots)).toEqual({ ok: false, reason: "missing" });
    expect(await locate("docs/../../outside/secret.md", roots)).toEqual({ ok: false, reason: "outside" });
    expect(await locate("docs/link.md", roots)).toEqual({ ok: false, reason: "outside" });
    expect(await locate("docs", roots)).toEqual({ ok: false, reason: "missing" });
  });
});

describe("readDocument (§5.3)", () => {
  it("answers the text, the mtime and the size; never writes", async () => {
    const before = fs.statSync(path.join(folder, "docs", "plan.md")).mtimeMs;
    const r = await readDocument("docs/plan.md", roots);
    expect(r).toMatchObject({ ok: true, text: "# Plan\n", size: 7 });
    expect(r.ok && r.mtime).toBe(fs.statSync(path.join(folder, "docs", "plan.md")).mtime.toISOString());
    expect(fs.statSync(path.join(folder, "docs", "plan.md")).mtimeMs).toBe(before);
  });
  it("reads .markdown too, and from a reference folder", async () => {
    expect(await readDocument("docs/long.markdown", roots)).toMatchObject({ ok: true, text: "# Long\n" });
    expect(await readDocument("guides/style.md", roots)).toMatchObject({ ok: true, text: "# Style\n" });
  });
  it("refuses outside paths, links out, other kinds of file and huge files", async () => {
    expect(await readDocument("docs/../../outside/secret.md", roots)).toEqual({ ok: false, reason: "outside" });
    expect(await readDocument("docs/link.md", roots)).toEqual({ ok: false, reason: "outside" });
    expect(await readDocument("docs/notes.txt", roots)).toEqual({ ok: false, reason: "not-markdown" });
    expect(await readDocument("docs/disguised.md", roots)).toEqual({ ok: false, reason: "not-markdown" });
    expect(await readDocument("docs/gone.md", roots)).toEqual({ ok: false, reason: "missing" });
    const big = path.join(folder, "docs", "big.md");
    fs.writeFileSync(big, Buffer.alloc(MAX_DOCUMENT_BYTES + 1, 0x61));
    expect(await readDocument("docs/big.md", roots)).toEqual({ ok: false, reason: "too-large", size: MAX_DOCUMENT_BYTES + 1 });
    fs.rmSync(big);
  });
});

describe("readImage", () => {
  it("a local image as a data URL; never SVG, never outside", async () => {
    expect(await readImage("docs/pic.png", roots)).toBe(`data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}`);
    expect(await readImage("docs/pic.JPG", roots)).toMatch(/^data:image\/jpeg;base64,/);
    expect(await readImage("docs/pic.svg", roots)).toBeNull();
    expect(await readImage("docs/link.png", roots)).toBeNull();
    expect(await readImage("docs/../../outside/secret.png", roots)).toBeNull();
    expect(await readImage("docs/missing.png", roots)).toBeNull();
  });
  it("refuses images over 5 MB", async () => {
    const big = path.join(folder, "docs", "big.webp");
    fs.writeFileSync(big, Buffer.alloc(MAX_IMAGE_BYTES + 1));
    expect(await readImage("docs/big.webp", roots)).toBeNull();
    fs.rmSync(big);
  });
});

describe("documentsExist", () => {
  it("one answer per path", async () => {
    expect(await documentsExist(["docs/plan.md", "docs/gone.md", "../outside/secret.md"], roots)).toEqual([true, false, false]);
  });
  it("refuses a list that isn't one", async () => {
    expect(await documentsExist("docs/plan.md" as unknown as unknown[], roots)).toEqual([]);
  });
});

describe("DocumentWatchers (live reload)", () => {
  it("tells once after a quiet moment when the file changes, also through a rename; not for other files", async () => {
    const changed = vi.fn();
    const w = new DocumentWatchers(changed, 50);
    const id = await w.watch("docs/plan.md", roots);
    expect(id).toEqual(expect.any(Number));
    fs.writeFileSync(path.join(folder, "docs", "other.md"), "x");
    await new Promise((r) => setTimeout(r, 200));
    expect(changed).not.toHaveBeenCalled();
    const tmp = path.join(folder, "docs", "plan.md.tmp");
    fs.writeFileSync(tmp, "# Plan v2\n");
    fs.renameSync(tmp, path.join(folder, "docs", "plan.md"));
    fs.appendFileSync(path.join(folder, "docs", "plan.md"), "more\n");
    await vi.waitFor(() => expect(changed).toHaveBeenCalledWith(id), { timeout: 2000 });
    await new Promise((r) => setTimeout(r, 150));
    expect(changed).toHaveBeenCalledTimes(1);
    w.unwatch(id);
    fs.appendFileSync(path.join(folder, "docs", "plan.md"), "again\n");
    await new Promise((r) => setTimeout(r, 200));
    expect(changed).toHaveBeenCalledTimes(1);
    w.closeAll();
  });

  it("refuses to watch outside the folder", async () => {
    const w = new DocumentWatchers(() => {}, 50);
    expect(await w.watch("docs/../../outside/secret.md", roots)).toBeNull();
    expect(await w.watch("docs/link.md", roots)).toBeNull();
  });
});
