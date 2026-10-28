import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { readTarget } from "../src/mock-claude";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-mock-read-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("readTarget (context-panel spec §7)", () => {
  const work = fs.mkdtempSync(path.join(root, "work-"));
  const outside = fs.mkdtempSync(path.join(root, "out-"));
  fs.writeFileSync(path.join(outside, "secret.md"), "s");
  fs.writeFileSync(path.join(work, "README.md"), "r");
  fs.symlinkSync(outside, path.join(work, "linked"));
  fs.symlinkSync(path.join(outside, "secret.md"), path.join(work, "secret.md"));

  it("a file inside the folder, there or not yet", () => {
    expect(readTarget(work, "README.md")).toBe(path.join(work, "README.md"));
    expect(readTarget(work, "docs/new.md")).toBe(path.join(work, "docs", "new.md"));
  });

  it("refuses a path outside the folder", () => {
    expect(() => readTarget(work, "../x.md")).toThrow("outside the work folder");
    expect(() => readTarget(work, ".")).toThrow("outside the work folder");
  });

  it("refuses a folder link and a file link that lead outside", () => {
    expect(() => readTarget(work, "linked/secret.md")).toThrow("a symlink leads outside");
    expect(() => readTarget(work, "linked/gone.md")).toThrow("a symlink leads outside");
    expect(() => readTarget(work, "secret.md")).toThrow("a symlink leads outside");
  });
});
