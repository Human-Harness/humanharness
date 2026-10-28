import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History, appHistoryKeep } from "@humanharness/workspace";
import { materialOwn, notePath, saveAppChange } from "../src/main/app-change";
import { restoreTaskByPaths } from "../src/main/restore-paths";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-appchange-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let history: History;
const write = (rel: string, c: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), c);
};
const exists = (rel: string) => fs.existsSync(path.join(folder, rel));

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "b-"));
  folder = path.join(base, "w");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "h.git"), [".harness/"], appHistoryKeep(true));
  await history.init();
  write("a0.md", "start");
  await history.save("Start");
});

async function filesOf(sha: string): Promise<string[]> {
  return (await history.commitChanges(sha)).map((c) => c.path).sort();
}

describe("saveAppChange: a change of the app's own files (parallel spec §5.3)", () => {
  it("board mode: task A's note commit never holds task B's work, and undoing A keeps it", async () => {
    // A's turn wrote a.md (its own commit); B's turn is writing b.md right now.
    await history.save("Before message", { task: "ta" });
    write("a.md", "a");
    await history.commitPaths(["a.md"], "Turn: A", { task: "ta" });
    write("b.md", "b");
    // A's closing note.
    const note = notePath(false, undefined, "a");
    write(note, "# A\n");
    await saveAppChange(history, true, [note], "Note: A", { task: "ta" });
    const [last] = await history.list(1);
    expect(await filesOf(last.sha)).toEqual([".harness/notes/a.md"]);
    // B's turn ends: b.md is still B's to commit.
    expect(await history.commitPaths(["b.md"], "Turn: B", { task: "tb" })).not.toBeNull();
    const undo = await restoreTaskByPaths(history, "ta", { running: [], includeShared: false });
    expect(undo).toMatchObject({ ok: true });
    expect(undo.ok && [...undo.paths].sort()).toEqual([".harness/notes/a.md", "a.md"]);
    expect(exists("b.md")).toBe(true);
    expect(exists("a.md")).toBe(false);
  });

  it("board mode with a test: only the changed paths it accepts (the material of a scope)", async () => {
    write("material/s1/doc.pdf", "pdf");
    write(".harness/material/s1/sources.json", "[]");
    write(".harness/material/s2/sources.json", "[]");
    write("b.md", "b");
    await saveAppChange(history, true, materialOwn("s1"), "Material: added doc", { task: "ta" });
    const [last] = await history.list(1);
    expect(await filesOf(last.sha)).toEqual([".harness/material/s1/sources.json", "material/s1/doc.pdf"]);
  });

  it("board mode, nothing of its own changed: no commit", async () => {
    write("b.md", "b");
    const before = (await history.list(1))[0].sha;
    await saveAppChange(history, true, [notePath(true, "s1", "x")], "Note: X", { task: "ta" });
    expect((await history.list(1))[0].sha).toBe(before);
  });

  it("plain mode (D0): the whole folder, as before", async () => {
    write("b.md", "b");
    write(".harness/notes/a.md", "# A\n");
    await saveAppChange(history, false, [".harness/notes/a.md"], "Note: A", { task: "ta" });
    const [last] = await history.list(1);
    expect(await filesOf(last.sha)).toEqual([".harness/notes/a.md", "b.md"]);
  });

  it("note paths as writeNote writes them", () => {
    expect(notePath(false, undefined, "intro")).toBe(".harness/notes/intro.md");
    expect(notePath(true, "fracciones", "intro")).toBe(".harness/notes/fracciones/intro.md");
  });
});

describe("index.ts: the app's own changes go through saveAppChange, board mode decided by the host", () => {
  const index = fs.readFileSync(path.resolve(__dirname, "../src/main/index.ts"), "utf8");
  it("material, Sidekick's decision note and learning, and a lane's note", () => {
    expect(index).not.toMatch(/\?\.save\(`Material:/);
    expect(index).not.toMatch(/\?\.save\(`Note: \$\{title\}`/);
    expect(index).not.toMatch(/\?\.save\(`\$\{DATA_CHANGE_PREFIX\}\$\{SIDEKICK_COLLECTION\}`/);
    expect([...index.matchAll(/saveAppChange\(await currentHistory\(\), host !== null, /g)]).toHaveLength(2);
    expect(index).toMatch(/saveAppChange\(history, host !== null, materialOwn\(scope\), `Material: \$\{what\}`/);
    expect(index).toMatch(/saveOwn: async \(paths, message, trailer\) => saveAppChange\(await currentHistory\(\), true, paths, message, trailer\)/);
    // The person's data writes: board mode is the host's.
    expect(index).toMatch(/\n  board: \(\) => host !== null,\n/);
  });
});
