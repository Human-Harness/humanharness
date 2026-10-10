import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { prepareFolder } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const tmp = () => fs.mkdtempSync(path.join(root, "t-"));

function seedDir(): string {
  const seed = tmp();
  fs.mkdirSync(path.join(seed, "notes"));
  fs.writeFileSync(path.join(seed, "README.md"), "seed");
  fs.writeFileSync(path.join(seed, "notes", "first.md"), "first");
  return seed;
}

describe("prepareFolder", () => {
  it("creates the folder and copies the seed the first time", async () => {
    const folder = path.join(tmp(), "Work");
    expect(await prepareFolder(folder, seedDir())).toBe(true);
    expect(fs.readFileSync(path.join(folder, "notes", "first.md"), "utf8")).toBe("first");
  });

  it("does not copy the seed into a folder that already has content", async () => {
    const folder = tmp();
    fs.writeFileSync(path.join(folder, "mine.md"), "mine");
    expect(await prepareFolder(folder, seedDir())).toBe(false);
    expect(fs.existsSync(path.join(folder, "README.md"))).toBe(false);
  });

  it("treats a folder holding only .harness as empty", async () => {
    const folder = tmp();
    fs.mkdirSync(path.join(folder, ".harness"));
    expect(await prepareFolder(folder, seedDir())).toBe(true);
  });

  it("works without a seed", async () => {
    const folder = path.join(tmp(), "Empty");
    expect(await prepareFolder(folder)).toBe(false);
    expect(fs.existsSync(folder)).toBe(true);
  });
});
