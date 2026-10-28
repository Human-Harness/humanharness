import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import { afterAll, describe, expect, it } from "vitest";
import type { Review } from "@humanharness/harness-sdk";
import { MAX_REVIEW_DOCUMENT_BYTES, ReviewLocks, ReviewRefused, blobId, canonicalDocumentPath, loadReview, newReview, readOwnDocument, reviewSummarySync, saveReview, writeOwnDocument } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-reviews-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const folder = () => {
  const f = fs.mkdtempSync(path.join(root, "f-"));
  fs.mkdirSync(path.join(f, "specs"));
  fs.writeFileSync(path.join(f, "specs", "a.md"), "## Scope\n\nFilter by size.\n");
  return f;
};

describe("readOwnDocument", () => {
  it("reads an .md of the person's folder", async () => {
    const f = folder();
    expect(await readOwnDocument(f, "specs/a.md")).toMatchObject({ ok: true, text: "## Scope\n\nFilter by size.\n" });
  });

  it("refuses what a review may never touch", async () => {
    const f = folder();
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.writeFileSync(path.join(outside, "x.md"), "x");
    fs.symlinkSync(path.join(outside, "x.md"), path.join(f, "link.md"));
    fs.symlinkSync(outside, path.join(f, "linked"));
    fs.mkdirSync(path.join(f, ".harness"));
    fs.writeFileSync(path.join(f, ".harness", "n.md"), "n");
    fs.linkSync(path.join(f, "specs", "a.md"), path.join(f, "hard.md"));
    expect(await readOwnDocument(f, "../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, "link.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, "linked/x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, ".harness/n.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, "specs/../.harness/n.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, "hard.md")).toEqual({ ok: false, reason: "outside" });
    expect(await readOwnDocument(f, "specs/a.txt")).toEqual({ ok: false, reason: "not-markdown" });
    expect(await readOwnDocument(f, "specs/b.md")).toEqual({ ok: false, reason: "missing" });
    // `.HARNESS` names the same folder on a disk that ignores case, and is refused on any disk.
    expect(await readOwnDocument(f, ".HARNESS/n.md")).toEqual({ ok: false, reason: "outside" });
  });

  it("refuses a document over the size a review takes", async () => {
    const f = folder();
    fs.writeFileSync(path.join(f, "big.md"), Buffer.alloc(MAX_REVIEW_DOCUMENT_BYTES + 1, 0x61));
    expect(await readOwnDocument(f, "big.md")).toEqual({ ok: false, reason: "too-large" });
  });
});

describe("canonicalDocumentPath", () => {
  it("gives one key for every spelling of a document", async () => {
    const f = folder();
    for (const p of ["specs/a.md", "./specs/a.md", "specs//a.md", "x/../specs/a.md", "specs/./a.md"]) {
      expect(await canonicalDocumentPath(f, p)).toBe("specs/a.md");
      expect(await readOwnDocument(f, p)).toMatchObject({ ok: true, path: "specs/a.md" });
    }
    // A missing document keeps the name asked, without the extra parts.
    expect(await canonicalDocumentPath(f, "./specs/new.md")).toBe("specs/new.md");
    expect(await canonicalDocumentPath(f, "../a.md")).toBeNull();
  });

  it("gives the name as stored on a disk that ignores case", async () => {
    const f = folder();
    if (!fs.existsSync(path.join(f, "SPECS", "A.MD"))) return; // a case-sensitive disk: nothing to fold
    expect(await canonicalDocumentPath(f, "SPECS/A.MD")).toBe("specs/a.md");
    expect(await readOwnDocument(f, "SPECS/A.MD")).toMatchObject({ ok: true, path: "specs/a.md" });
  });

  it("the record refuses any other spelling, so it never splits", async () => {
    const f = folder();
    for (const p of ["./specs/a.md", "specs//a.md", "x/../specs/a.md"]) {
      await expect(saveReview(f, newReview(p, null))).rejects.toBeInstanceOf(ReviewRefused);
      await expect(loadReview(f, p)).rejects.toBeInstanceOf(ReviewRefused);
    }
    expect(fs.existsSync(path.join(f, ".harness"))).toBe(false);
  });
});

describe("writeOwnDocument", () => {
  it("writes only when the bytes are still the ones read", async () => {
    const f = folder();
    const first = await readOwnDocument(f, "specs/a.md");
    if (!first.ok) throw new Error();
    expect(await writeOwnDocument(f, "specs/a.md", first.bytes, "## Scope\n\nBy colour.\n")).toMatchObject({ ok: true });
    expect(fs.readFileSync(path.join(f, "specs", "a.md"), "utf8")).toBe("## Scope\n\nBy colour.\n");
    expect(await writeOwnDocument(f, "specs/a.md", first.bytes, "again")).toEqual({ ok: false, reason: "changed" });
    expect(fs.readdirSync(path.join(f, "specs"))).toEqual(["a.md"]);
  });

  it("keeps the file's mode, past the umask", async () => {
    const f = folder();
    const file = path.join(f, "specs", "a.md");
    fs.chmodSync(file, 0o666);
    const first = await readOwnDocument(f, "specs/a.md");
    if (!first.ok) throw new Error();
    expect(await writeOwnDocument(f, "specs/a.md", first.bytes, "x\n")).toMatchObject({ ok: true });
    expect(fs.statSync(file).mode & 0o777).toBe(0o666);
  });

  it("refuses a link, a hard link and a text over the size a review takes", async () => {
    const f = folder();
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.writeFileSync(path.join(outside, "x.md"), "x");
    fs.symlinkSync(path.join(outside, "x.md"), path.join(f, "link.md"));
    fs.linkSync(path.join(outside, "x.md"), path.join(f, "hard.md"));
    const x = Buffer.from("x");
    expect(await writeOwnDocument(f, "link.md", x, "y")).toEqual({ ok: false, reason: "outside" });
    expect(await writeOwnDocument(f, "hard.md", x, "y")).toEqual({ ok: false, reason: "outside" });
    expect(fs.readFileSync(path.join(outside, "x.md"), "utf8")).toBe("x");
    const first = await readOwnDocument(f, "specs/a.md");
    if (!first.ok) throw new Error();
    expect(await writeOwnDocument(f, "specs/a.md", first.bytes, "a".repeat(MAX_REVIEW_DOCUMENT_BYTES + 1))).toEqual({ ok: false, reason: "too-large" });
  });
});

describe("blobId", () => {
  it("is git's blob id", async () => {
    const bytes = Buffer.from("## Scope\n");
    expect(blobId(bytes)).toBe((await git.hashBlob({ object: bytes })).oid);
  });
});

describe("the record", () => {
  const record = (doc: string): Review => newReview(doc, { id: "t1", scope: "main" });

  it("round-trips under .harness/reviews, folders kept", async () => {
    const f = folder();
    await saveReview(f, record("specs/a.md"));
    expect(fs.existsSync(path.join(f, ".harness", "reviews", "specs", "a.md.json"))).toBe(true);
    expect(await loadReview(f, "specs/a.md")).toEqual({ path: "specs/a.md", task: "t1", scope: "main", comments: [], approvals: [] });
    expect(await loadReview(f, "specs/none.md")).toBeNull();
  });

  it("a broken record is refused, never trusted", async () => {
    const f = folder();
    fs.mkdirSync(path.join(f, ".harness", "reviews", "specs"), { recursive: true });
    fs.writeFileSync(path.join(f, ".harness", "reviews", "specs", "a.md.json"), '{"path":"specs/a.md","task":null,"comments":[{}],"approvals":[]}');
    await expect(loadReview(f, "specs/a.md")).rejects.toBeInstanceOf(ReviewRefused);
  });

  it("refuses to write through a linked reviews folder", async () => {
    const f = folder();
    const outside = fs.mkdtempSync(path.join(root, "out-"));
    fs.mkdirSync(path.join(f, ".harness"));
    fs.symlinkSync(outside, path.join(f, ".harness", "reviews"));
    await expect(saveReview(f, record("specs/a.md"))).rejects.toBeInstanceOf(ReviewRefused);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  it("the CLI's sync summary", async () => {
    const f = folder();
    expect(reviewSummarySync(f, "specs/a.md")).toBeNull();
    await saveReview(f, record("specs/a.md"));
    expect(reviewSummarySync(f, "specs/a.md")).toMatchObject({ status: "draft", questions: 0 });
  });

  it("a record that names another document, or is too big, is broken", async () => {
    const f = folder();
    const rec = path.join(f, ".harness", "reviews", "specs", "a.md.json");
    fs.mkdirSync(path.dirname(rec), { recursive: true });
    fs.writeFileSync(rec, JSON.stringify(record("specs/b.md")));
    await expect(loadReview(f, "specs/a.md")).rejects.toBeInstanceOf(ReviewRefused);
    expect(reviewSummarySync(f, "specs/a.md")).toBeNull();
    fs.writeFileSync(rec, " ".repeat(5 * 1024 * 1024 + 1));
    await expect(loadReview(f, "specs/a.md")).rejects.toBeInstanceOf(ReviewRefused);
    expect(reviewSummarySync(f, "specs/a.md")).toBeNull();
  });
});

describe("ReviewLocks", () => {
  it("runs one thing at a time per document", async () => {
    const locks = new ReviewLocks();
    const order: string[] = [];
    const slow = locks.run("a.md", async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push("first");
    });
    const fast = locks.run("a.md", async () => order.push("second"));
    const other = locks.run("b.md", async () => order.push("other"));
    await Promise.all([slow, fast, other]);
    expect(order).toEqual(["other", "first", "second"]);
  });
});
