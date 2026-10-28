import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { blobId, readCapped, readPrefix } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-safe-read-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
const yes = async () => true;

describe("readPrefix (file-timeline spec §4.2)", () => {
  it("the first bytes and the whole size; the blob id only when asked", async () => {
    const file = path.join(root, "a.txt");
    const content = "0123456789".repeat(10_000);
    fs.writeFileSync(file, content);
    expect(await readPrefix(file, 5, yes)).toEqual({ bytes: Buffer.from("01234"), size: 100_000 });
    const asked: number[] = [];
    const got = await readPrefix(file, 5, yes, (size) => (asked.push(size), true));
    expect(asked).toEqual([100_000]);
    expect(got).toEqual({ bytes: Buffer.from("01234"), size: 100_000, oid: blobId(Buffer.from(content)) });
    expect((await readPrefix(file, 1_000_000, yes, () => true))?.oid).toBe(blobId(Buffer.from(content)));
    expect((await readPrefix(file, 5, yes, () => false))?.oid).toBeUndefined();
  });

  it("refuses what readCapped refuses: a link, a hard link, an unsafe path", async () => {
    const file = path.join(root, "b.txt");
    fs.writeFileSync(file, "b");
    const link = path.join(root, "link.txt");
    fs.symlinkSync(file, link);
    expect(await readPrefix(link, 10, yes)).toBeNull();
    expect(await readPrefix(file, 10, async () => false)).toBeNull();
    fs.linkSync(file, path.join(root, "hard.txt"));
    expect(await readPrefix(file, 10, yes)).toBeNull();
    expect(await readCapped(file, 10, yes)).toBeNull();
  });

  it("readCapped still reads a small file whole and gives the size of a big one", async () => {
    const file = path.join(root, "c.txt");
    fs.writeFileSync(file, "hello");
    expect(await readCapped(file, 10, yes)).toMatchObject({ bytes: Buffer.from("hello") });
    expect(await readCapped(file, 2, yes)).toEqual({ size: 5 });
  });
});
