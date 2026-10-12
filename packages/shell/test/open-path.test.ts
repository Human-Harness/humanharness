import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openIfStillSafe, openableFile } from "../src/main/open-path";

const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hh-")));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const ref = path.join(root, "ref");
const folder = path.join(root, "work");
const outside = path.join(root, "outside");
for (const d of [path.join(ref, "packages"), path.join(folder, ".harness", "notes"), outside]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(ref, "packages", "a.ts"), "x");
fs.writeFileSync(path.join(folder, ".harness", "notes", "turn.md"), "x");
fs.writeFileSync(path.join(outside, "secret.md"), "x");
fs.writeFileSync(path.join(ref, "run.command"), "x");
fs.symlinkSync(path.join(outside, "secret.md"), path.join(ref, "link.md"));
for (const f of ["page.html", "page.htm", "pic.svg", "a.js", "a.mjs", "a.cjs"]) fs.writeFileSync(path.join(ref, f), "x");

describe("openableFile", () => {
  const roots = [ref, folder];
  it("finds a file in the first root that has it", async () => {
    expect(await openableFile("packages/a.ts", roots)).toBe(path.join(ref, "packages", "a.ts"));
    expect(await openableFile(".harness/notes/turn.md", roots)).toBe(path.join(folder, ".harness", "notes", "turn.md"));
  });

  it("refuses escapes, links that point outside, folders, programs and junk", async () => {
    expect(await openableFile("../outside/secret.md", roots)).toBeNull();
    expect(await openableFile(path.join(outside, "secret.md"), roots)).toBeNull();
    expect(await openableFile("link.md", roots)).toBeNull();
    expect(await openableFile("packages", roots)).toBeNull();
    expect(await openableFile("run.command", roots)).toBeNull();
    expect(await openableFile("missing.md", roots)).toBeNull();
    expect(await openableFile(42, roots)).toBeNull();
    expect(await openableFile("a\0b.md", roots)).toBeNull();
  });

  it("refuses pages, images and scripts the system would run in a browser or an interpreter", async () => {
    for (const f of ["page.html", "page.htm", "pic.svg", "a.js", "a.mjs", "a.cjs"]) expect(await openableFile(f, roots)).toBeNull();
  });
});

describe("openIfStillSafe", () => {
  it("opens a regular file, and refuses one replaced by a link or gone since it was checked", async () => {
    const opened: string[] = [];
    const open = async (p: string) => {
      opened.push(p);
      return "";
    };
    const file = path.join(folder, "late.md");
    fs.writeFileSync(file, "x");
    expect(await openIfStillSafe(file, open)).toBe(true);
    fs.rmSync(file);
    fs.symlinkSync(path.join(outside, "secret.md"), file);
    expect(await openIfStillSafe(file, open)).toBe(false);
    expect(await openIfStillSafe(path.join(folder, "gone.md"), open)).toBe(false);
    expect(await openIfStillSafe(path.join(folder, ".harness"), open)).toBe(false);
    expect(opened).toEqual([file]);
    expect(await openIfStillSafe(path.join(ref, "packages", "a.ts"), async () => "no app")).toBe(false);
  });
});
