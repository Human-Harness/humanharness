import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readNoLinks, writeNoLinks } from "../src/no-links";

const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "hh-no-links-"));

describe("no-links caps", () => {
  it("reads a small file under a huge cap without allocating the cap", async () => {
    const root = await tmp();
    const file = path.join(root, "a", "f.json");
    await writeNoLinks(root, file, "hello");
    expect(await readNoLinks(root, file, 2 ** 40)).toBe("hello");
  });
  it("refuses a write over maxBytes before writing, unless it is no larger than the file it replaces", async () => {
    const root = await tmp();
    const file = path.join(root, "f.json");
    await expect(writeNoLinks(root, file, "x".repeat(11), 10)).rejects.toThrow(/too large/);
    expect(await fs.readdir(root)).toEqual([]);
    await fs.writeFile(file, "y".repeat(20));
    await writeNoLinks(root, file, "x".repeat(15), 10);
    expect(await fs.readFile(file, "utf8")).toBe("x".repeat(15));
    await expect(writeNoLinks(root, file, "x".repeat(16), 10)).rejects.toThrow(/too large/);
  });
});
