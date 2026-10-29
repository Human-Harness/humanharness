import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FILES_LIMITS, globMatch, toolFiles } from "../../src/main/tools/tool-files";

let root: string;
let base: string;
let refA: string;
let outside: string;

async function put(file: string, text = "x"): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

beforeEach(async () => {
  root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "hh-tool-files-")));
  base = path.join(root, "folder");
  refA = path.join(root, "ref-a");
  outside = path.join(root, "outside");
  await put(path.join(base, "notes.md"), "# Notes");
  await put(path.join(base, "notes", "a.md"), "a");
  await put(path.join(base, "notes", "deep", "b.md"), "b");
  await put(path.join(base, "notes", "c.txt"), "c");
  await put(path.join(refA, "guide", "intro.md"), "intro");
  await put(path.join(outside, "secret.txt"), "outside");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const files = () => toolFiles({ base, references: [{ id: "a", path: refA }] });

describe("ctx.files (tools spec §4.2; T8)", () => {
  it("read returns a file's text under the folder, at most 1 MB", async () => {
    expect(await files().read("notes.md")).toBe("# Notes");
    expect(await files().read("./notes/deep/b.md")).toBe("b");
    await put(path.join(base, "big.txt"), "x".repeat(FILES_LIMITS.readBytes + 1));
    await expect(files().read("big.txt")).rejects.toThrow("big.txt is larger than 1 MB");
    await expect(files().read("missing.md")).rejects.toThrow("missing.md is not there");
    await expect(files().read("notes")).rejects.toThrow("notes is not a file");
  });

  it("refuses .., an absolute path, a link out of the folder and a hard link", async () => {
    await expect(files().read("../outside/secret.txt")).rejects.toThrow("stays inside the folder");
    await expect(files().read("notes/../../outside/secret.txt")).rejects.toThrow("stays inside the folder");
    await expect(files().read(path.join(outside, "secret.txt"))).rejects.toThrow("is relative to the folder");
    await expect(files().read("")).rejects.toThrow("A path");
    await expect(files().read("a\0b")).rejects.toThrow("A path");
    await fs.symlink(path.join(outside, "secret.txt"), path.join(base, "file-link.txt"));
    await fs.symlink(outside, path.join(base, "dir-link"));
    await fs.link(path.join(outside, "secret.txt"), path.join(base, "hard.txt"));
    await expect(files().read("file-link.txt")).rejects.toThrow("file-link.txt is a link");
    await expect(files().read("dir-link/secret.txt")).rejects.toThrow("dir-link is a link");
    await expect(files().read("hard.txt")).rejects.toThrow("hard.txt is not a plain file");
  });

  it("reads under a reference root by its id prefix (refs/<id>/...)", async () => {
    expect(await files().read("refs/a/guide/intro.md")).toBe("intro");
    await expect(files().read("refs/b/guide/intro.md")).rejects.toThrow('No reference "b"');
    await expect(files().read("refs/a/../../outside/secret.txt")).rejects.toThrow("stays inside the folder");
    await expect(files().read("refs/__proto__/x")).rejects.toThrow("No reference");
  });

  it("list returns relative paths, sorted, at most 1000, with an optional glob (*, **)", async () => {
    expect(await files().list("notes")).toEqual(["notes/a.md", "notes/c.txt", "notes/deep/b.md"]);
    expect(await files().list("", "*.md")).toEqual(["notes.md"]);
    expect(await files().list("notes", "*.md")).toEqual(["notes/a.md"]);
    expect(await files().list(".", "**/*.md")).toEqual(["notes.md", "notes/a.md", "notes/deep/b.md"]);
    expect(await files().list("refs/a")).toEqual(["refs/a/guide/intro.md"]);
    await expect(files().list("..")).rejects.toThrow("stays inside the folder");
    await expect(files().list("notes.md")).rejects.toThrow("notes.md is not a folder");
    const many = path.join(base, "many");
    await fs.mkdir(many);
    for (let i = 0; i < FILES_LIMITS.listEntries + 5; i++) await fs.writeFile(path.join(many, `f${String(i).padStart(4, "0")}.txt`), "");
    const listed = await files().list("many");
    expect(listed).toHaveLength(FILES_LIMITS.listEntries);
    expect(listed[0]).toBe("many/f0000.txt");
  });

  it("list skips links, hard links and never follows a link out", async () => {
    await fs.symlink(outside, path.join(base, "notes", "dir-link"));
    await fs.symlink(path.join(outside, "secret.txt"), path.join(base, "notes", "file-link.txt"));
    await fs.link(path.join(outside, "secret.txt"), path.join(base, "notes", "hard.txt"));
    expect(await files().list("notes")).toEqual(["notes/a.md", "notes/c.txt", "notes/deep/b.md"]);
  });

  it("never lists .harness/ or .git/", async () => {
    await put(path.join(base, ".harness", "chat.json"), "{}");
    await put(path.join(base, ".git", "HEAD"), "ref");
    await put(path.join(base, "notes", ".git", "config"), "x");
    expect(await files().list("", "**")).toEqual(["notes.md", "notes/a.md", "notes/c.txt", "notes/deep/b.md"]);
    await expect(files().read(".harness/chat.json")).rejects.toThrow(".harness");
    await expect(files().read("notes/.git/config")).rejects.toThrow(".git");
    await expect(files().list(".git")).rejects.toThrow(".git");
  });
});

describe("globMatch: a matcher over path segments, no RegExp", () => {
  it("* stays within a segment; ** spans segments, zero or more", () => {
    expect(globMatch("*.md", "a.md")).toBe(true);
    expect(globMatch("*.md", "x/a.md")).toBe(false);
    expect(globMatch("**/*.md", "a.md")).toBe(true);
    expect(globMatch("**/*.md", "x/y/a.md")).toBe(true);
    expect(globMatch("x/**", "x/y/z")).toBe(true);
    expect(globMatch("a*b*c", "aXbYc")).toBe(true);
    expect(globMatch("a*b*c", "aXbY")).toBe(false);
    expect(globMatch("(.*)+", "(.*)+")).toBe(true);
    expect(globMatch("(.*)+", "aaa")).toBe(false);
  });
});
