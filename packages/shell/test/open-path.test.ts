import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { openableFile } from "../src/main/open-path";

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
});
