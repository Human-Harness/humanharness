import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { History } from "@humanharness/workspace";
import { beginTurn, endTurn } from "../src/turn-commit";
import { TurnLedger } from "../src/turn-ledger";
import { git, messages, treeOf } from "./helpers/git";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-tcommit-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));
let folder: string;
let gitdir: string;
let history: History;
let ledger: TurnLedger;
const write = (rel: string, c: string) => fs.writeFileSync(path.join(folder, rel), c);
const read = (rel: string) => fs.readFileSync(path.join(folder, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(folder, rel));
const abs = (rel: string) => path.join(folder, rel);
const subjects = () => messages(gitdir);
const head = async () => (await git.log({ fs, gitdir }))[0].oid;
const ok = { type: "done", ok: true } as const;
const stopped = { type: "done", ok: false, error: { code: "cancelled", message: "Stopped" } } as const;
const crashed = { type: "done", ok: false, error: { code: "agent-crashed", message: "gone" } } as const;

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  gitdir = path.join(base, "history.git");
  fs.mkdirSync(folder);
  history = new History(folder, gitdir, [".harness/"]);
  await history.init();
  write("seed.md", "s");
  await history.save("Start");
  ledger = TurnLedger.forFolder(folder);
});

describe("one turn alone: today's commits (D7)", () => {
  it("Before message, then Turn; no attribution", async () => {
    write("person.md", "p");
    const w = await beginTurn(history, ledger, "A", { task: "t1" });
    expect(w.alone).toBe(true);
    write("a.md", "a");
    expect(await endTurn(history, ledger, w, ok, "write a", { task: "t1" })).toBeNull();
    expect(await subjects()).toEqual(["Start", "Before message\n\nTask: t1", "Turn: write a\n\nTask: t1"]);
    expect(await treeOf(gitdir, await head())).toEqual({ "a.md": "a", "person.md": "p", "seed.md": "s" });
    expect(ledger.anyRunning()).toBe(false);
  });

  it("a crash restores the whole folder to before, as today: no Undo commit (the D0 golden pins it)", async () => {
    write("person.md", "p");
    const w = await beginTurn(history, ledger, "A", { task: "t1" });
    write("a.md", "a");
    write("seed.md", "changed");
    expect(await endTurn(history, ledger, w, crashed, "crash", { task: "t1" })).toBeNull();
    expect(exists("a.md")).toBe(false);
    expect(read("seed.md")).toBe("s");
    expect(read("person.md")).toBe("p");
    expect(await subjects()).toEqual(["Start", "Before message\n\nTask: t1"]);
  });

  it("a job's crash alone restores only the paths it named, from the head: an app commit meanwhile stays", async () => {
    const job = { task: "j1", job: "digest" };
    const w = await beginTurn(history, ledger, "J", job);
    expect(w.alone).toBe(true);
    // Single mode: the person's data write commits the folder while the job runs.
    write("data.json", "{}");
    await history.save("Data: save", { task: "t1" });
    write("job.md", "half");
    write("seed.md", "job half");
    ledger.noteEdits("J", [abs("job.md"), abs("seed.md")]);
    write("loose.md", "?");
    const before = await subjects();
    expect(await endTurn(history, ledger, w, crashed, "digest", job)).toBeNull();
    expect(read("data.json")).toBe("{}");
    expect(exists("job.md")).toBe(false);
    expect(read("seed.md")).toBe("s");
    // A path it didn't name may be someone else's: it stays for the next commit.
    expect(read("loose.md")).toBe("?");
    expect(await subjects()).toEqual(before);
    expect(ledger.anyRunning()).toBe(false);
  });

  it("a stopped turn commits as Stopped, as today", async () => {
    const w = await beginTurn(history, ledger, "A", { task: "t1" });
    write("a.md", "a");
    await endTurn(history, ledger, w, stopped, "slow", { task: "t1" });
    expect(await subjects()).toEqual(["Start", "Stopped: slow\n\nTask: t1"]);
  });
});

describe("two turns at once (parallel spec §5.2, T1, T2)", () => {
  it("different files: each commit holds only its own; no shared commit", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    expect(b.alone).toBe(false);
    write("a.md", "a");
    ledger.noteEdits("A", [abs("a.md")]);
    write("b.md", "b");
    ledger.noteEdits("B", [abs("b.md")]);
    const ra = await endTurn(history, ledger, a, ok, "A", { task: "t1" });
    expect(ra).toEqual({ owned: ["a.md"], shared: [], with: [], conflicts: [] });
    const rb = await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    expect(rb).toEqual({ owned: ["b.md"], shared: [], with: [], conflicts: [] });
    expect(await subjects()).toEqual(["Start", "Turn: A\n\nTask: t1", "Turn: B\n\nTask: t2"]);
    const log = await git.log({ fs, gitdir });
    // T2: A's commit never holds B's in-flight b.md.
    expect(await treeOf(gitdir, log[1].oid)).toEqual({ "a.md": "a", "seed.md": "s" });
    expect(await treeOf(gitdir, log[0].oid)).toEqual({ "a.md": "a", "b.md": "b", "seed.md": "s" });
  });

  it("a path nobody named (a shell write) is shared in a second commit with Shared: trailers", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("a.md", "a");
    ledger.noteEdits("A", [abs("a.md")]);
    write("loose.md", "?");
    const ra = await endTurn(history, ledger, a, ok, "A", { task: "t1" });
    expect(ra).toEqual({ owned: ["a.md"], shared: ["loose.md"], with: ["t2"], conflicts: [] });
    expect((await subjects()).slice(-2)).toEqual(["Turn: A\n\nTask: t1", "Shared: A\n\nTask: t1\nShared: t2"]);
    expect(await treeOf(gitdir, await head())).toEqual({ "a.md": "a", "loose.md": "?", "seed.md": "s" });
    expect(await endTurn(history, ledger, b, ok, "B", { task: "t2" })).toEqual({ owned: [], shared: [], with: [], conflicts: [] });
  });

  it("the ending turn's own task is never in its Shared: trailers", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    // Another window of the same task (never in practice; it must still not share with itself).
    const a2 = await beginTurn(history, ledger, "A2", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("loose.md", "?");
    const ra = await endTurn(history, ledger, a, ok, "A", { task: "t1" });
    expect(ra?.with).toEqual(["t2"]);
    expect((await subjects()).at(-1)).toBe("Shared: A\n\nTask: t1\nShared: t2");
    await endTurn(history, ledger, a2, ok, "A2", { task: "t1" });
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
  });

  it("a path only another running turn named is left for it", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("b.md", "b");
    ledger.noteEdits("B", [abs("b.md")]);
    expect(await endTurn(history, ledger, a, ok, "A", { task: "t1" })).toEqual({ owned: [], shared: [], with: [], conflicts: [] });
    expect(await subjects()).toEqual(["Start"]);
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    expect(await subjects()).toEqual(["Start", "Turn: B\n\nTask: t2"]);
  });

  it("a stopped turn with overlap commits its own paths as Stopped", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("a.md", "a");
    ledger.noteEdits("A", [abs("a.md")]);
    await endTurn(history, ledger, a, stopped, "slow", { task: "t1" });
    expect((await subjects()).at(-1)).toBe("Stopped: slow\n\nTask: t1");
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
  });

  it("a crash with overlap restores only its own paths, from the queue head; no Undo commit", async () => {
    write("both.md", "0");
    await history.save("seed both");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("a.md", "a");
    write("both.md", "from A");
    ledger.noteEdits("A", [abs("a.md"), abs("both.md")]);
    write("b.md", "b");
    ledger.noteEdits("B", [abs("b.md")]);
    write("loose.md", "?");
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const before = await subjects();
    const ra = await endTurn(history, ledger, a, crashed, "A", { task: "t1" });
    expect(err).toHaveBeenCalledWith("Crash restore left shared paths", ["loose.md"]);
    err.mockRestore();
    expect(ra).toEqual({ owned: ["a.md", "both.md"], shared: ["loose.md"], with: ["t2"], conflicts: [] });
    // T1: its own paths are back; B's in-flight file and the shared one stay.
    expect(exists("a.md")).toBe(false);
    expect(read("both.md")).toBe("0");
    expect(read("b.md")).toBe("b");
    expect(read("loose.md")).toBe("?");
    expect(await subjects()).toEqual(before);
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    expect(await treeOf(gitdir, await head())).toEqual({ "b.md": "b", "both.md": "0", "loose.md": "?", "seed.md": "s" });
  });

  it("a crash restores from the head as it is then: another task's commit meanwhile isn't undone", async () => {
    write("spec.md", "0");
    await history.save("seed spec");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("spec.md", "from A");
    ledger.noteEdits("A", [abs("spec.md")]);
    // Another task commits spec.md as it is after A decided to restore, right before the restore runs.
    const restorePaths = history.restorePaths.bind(history);
    vi.spyOn(history, "restorePaths").mockImplementationOnce(async (...args) => {
      await history.commitPaths(["spec.md"], "Turn: other", { task: "t9" });
      return restorePaths(...args);
    });
    await endTurn(history, ledger, a, crashed, "A", { task: "t1" });
    expect(read("spec.md")).toBe("from A");
    expect(await treeOf(gitdir, await head())).toEqual({ "seed.md": "s", "spec.md": "from A" });
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
  });

  it("a crash leaves a path another running turn also named: its in-flight edit survives (P1)", async () => {
    write("spec.md", "0");
    await history.save("seed spec");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("spec.md", "A+B work");
    write("a.md", "a");
    ledger.noteEdits("A", [abs("spec.md"), abs("a.md")]);
    ledger.noteEdits("B", [abs("spec.md")]);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ra = await endTurn(history, ledger, a, crashed, "A", { task: "t1" });
    expect(err).toHaveBeenCalledWith("Crash restore left paths others also hold", ["spec.md"]);
    err.mockRestore();
    expect(ra?.owned).toEqual(["a.md", "spec.md"]);
    expect(read("spec.md")).toBe("A+B work");
    expect(exists("a.md")).toBe(false);
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    expect(await treeOf(gitdir, await head())).toEqual({ "seed.md": "s", "spec.md": "A+B work" });
  });

  it("a path left for a turn that then crashes keeps the ended turn's change (held)", async () => {
    write("spec.md", "0");
    await history.save("seed spec");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    // A changes spec.md without naming it (through the shell); only B named it.
    write("spec.md", "A's change");
    ledger.noteEdits("B", [abs("spec.md")]);
    expect(await endTurn(history, ledger, a, ok, "A", { task: "t1" })).toMatchObject({ owned: [], shared: [] });
    expect(b.held.has("spec.md")).toBe(true);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await endTurn(history, ledger, b, crashed, "B", { task: "t2" });
    expect(err).toHaveBeenCalledWith("Crash restore left paths others also hold", ["spec.md"]);
    err.mockRestore();
    expect(read("spec.md")).toBe("A's change");
  });

  it("a crash leaves a path already dirty when the turn opened beside another: earlier edits survive (P2)", async () => {
    write("spec.md", "0");
    await history.save("seed spec");
    const x = await beginTurn(history, ledger, "X", { task: "t0" });
    write("spec.md", "person edit");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    expect(a.startDirty?.has("spec.md")).toBe(true);
    write("spec.md", "person edit + A half");
    write("a.md", "a");
    ledger.noteEdits("A", [abs("spec.md"), abs("a.md")]);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await endTurn(history, ledger, a, crashed, "A", { task: "t1" });
    expect(err).toHaveBeenCalledWith("Crash restore left paths others also hold", ["spec.md"]);
    err.mockRestore();
    expect(read("spec.md")).toBe("person edit + A half");
    expect(exists("a.md")).toBe(false);
    await endTurn(history, ledger, x, ok, "X", { task: "t0" });
  });

  it("no valid task id to share with: no Shared commit (its paths would read as owned), logged", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    // A window with no task, under a key no trailer can carry.
    const b = await beginTurn(history, ledger, "slot b");
    write("a.md", "a");
    ledger.noteEdits("A", [abs("a.md")]);
    write("loose.md", "?");
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await endTurn(history, ledger, a, ok, "A", { task: "t1" })).toMatchObject({ owned: ["a.md"], shared: ["loose.md"] });
    expect(err).toHaveBeenCalledWith("Shared paths left uncommitted: no other task to name", ["loose.md"]);
    err.mockRestore();
    expect((await subjects()).at(-1)).toBe("Turn: A\n\nTask: t1");
    expect(await treeOf(gitdir, await head())).toEqual({ "a.md": "a", "seed.md": "s" });
    await endTurn(history, ledger, b, ok, "B");
  });

  it("with no trailer, the Shared commit carries none either, like the owned one", async () => {
    const a = await beginTurn(history, ledger, "A");
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("a.md", "a");
    ledger.noteEdits("A", [abs("a.md")]);
    write("loose.md", "?");
    expect(await endTurn(history, ledger, a, ok, "A")).toMatchObject({ owned: ["a.md"], shared: ["loose.md"], with: ["t2"] });
    expect((await subjects()).slice(-2)).toEqual(["Turn: A", "Shared: A"]);
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
  });

  it("a failing conflict check is logged; the turn's end still resolves with its commits", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("a.md", "a");
    ledger.noteEdits("A", [abs("a.md")]);
    vi.spyOn(history, "commitsSince").mockRejectedValueOnce(new Error("log broke"));
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await endTurn(history, ledger, a, ok, "A", { task: "t1" })).toEqual({ owned: ["a.md"], shared: [], with: [], conflicts: [] });
    expect(err).toHaveBeenCalledWith("Conflict check failed", expect.any(Error));
    err.mockRestore();
    expect((await subjects()).at(-1)).toBe("Turn: A\n\nTask: t1");
    expect(ledger.running().map((w) => w.key)).toEqual(["B"]);
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
  });

  it("a start beyond the look-back depth still reports the conflicts of the commits seen (history only appends)", async () => {
    write("spec.md", "0");
    await history.save("seed spec");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    for (let i = 0; i < 200; i++) {
      write("spec.md", `t9 #${i}`);
      await history.commitPaths(["spec.md"], `Turn: ${i}`, { task: "t9" });
    }
    write("spec.md", "from A");
    ledger.noteEdits("A", [abs("spec.md")]);
    expect((await endTurn(history, ledger, a, ok, "A", { task: "t1" }))?.conflicts).toEqual([{ path: "spec.md", tasks: ["t9"] }]);
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
  });

  it("the same file: the second turn reports a conflict with the first's task", async () => {
    write("spec.md", "0");
    await history.save("seed spec");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("spec.md", "from A");
    ledger.noteEdits("A", [abs("spec.md")]);
    expect((await endTurn(history, ledger, a, ok, "A", { task: "t1" }))?.conflicts).toEqual([]);
    write("spec.md", "from B");
    ledger.noteEdits("B", [abs("spec.md")]);
    const rb = await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    expect(rb?.owned).toEqual(["spec.md"]);
    expect(rb?.conflicts).toEqual([{ path: "spec.md", tasks: ["t1"] }]);
    expect(read("spec.md")).toBe("from B");
  });

  it("the same file written alike: the second turn, with nothing left to commit, still reports the conflict", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("spec.md", "spec");
    ledger.noteEdits("A", [abs("spec.md")]);
    expect((await endTurn(history, ledger, a, ok, "A", { task: "t1" }))?.conflicts).toEqual([]);
    ledger.noteEdits("B", [abs("spec.md")], "eb");
    write("spec.md", "spec");
    ledger.noteEditEnd("B", "eb", false);
    const rb = await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    expect(rb).toEqual({ owned: [], shared: [], with: [], conflicts: [{ path: "spec.md", tasks: ["t1"] }] });
  });

  it("both named the file before the first ended: the first commits it, the second still reports the conflict", async () => {
    write("spec.md", "0");
    await history.save("seed spec");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("spec.md", "from A");
    ledger.noteEdits("A", [abs("spec.md")]);
    ledger.noteEdits("B", [abs("spec.md")], "eb");
    write("spec.md", "from B");
    ledger.noteEditEnd("B", "eb", false);
    expect(await endTurn(history, ledger, a, ok, "A", { task: "t1" })).toEqual({ owned: ["spec.md"], shared: [], with: [], conflicts: [] });
    const rb = await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    expect(rb?.owned).toEqual([]);
    expect(rb?.conflicts).toEqual([{ path: "spec.md", tasks: ["t1"] }]);
  });

  it("an edit that only named the file (denied or failed) is no conflict, even when another task committed it", async () => {
    write("spec.md", "0");
    await history.save("seed spec");
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    ledger.noteEdits("B", [abs("spec.md")], "denied");
    ledger.noteEditEnd("B", "denied", true);
    // Named, never ended (the turn stopped mid-edit): no proof it wrote either.
    ledger.noteEdits("B", [abs("spec.md")], "open");
    write("spec.md", "from A");
    ledger.noteEdits("A", [abs("spec.md")]);
    await endTurn(history, ledger, a, ok, "A", { task: "t1" });
    expect(await endTurn(history, ledger, b, ok, "B", { task: "t2" })).toEqual({ owned: [], shared: [], with: [], conflicts: [] });
  });

  it("a file git spells NFD and an edit names NFC is one file: the conflict is found, once", async () => {
    const nfd = "cafe\u0301.md";
    const nfc = "caf\u00e9.md";
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write(nfd, "same");
    ledger.noteEdits("A", [abs(nfd)]);
    await endTurn(history, ledger, a, ok, "A", { task: "t1" });
    // The commit names the file as it was created; B's engine reports it NFC and writes the same text.
    vi.spyOn(history, "commitsSince").mockImplementationOnce(async () => [{ sha: "x", task: "t1", paths: [nfd] }] as never);
    ledger.noteEdits("B", [abs(nfc)], "eb");
    ledger.noteEditEnd("B", "eb", false);
    expect((await endTurn(history, ledger, b, ok, "B", { task: "t2" }))?.conflicts).toEqual([{ path: nfc, tasks: ["t1"] }]);
  });

  it("another task's commit after this turn's own commit is no conflict", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write("spec.md", "from A");
    ledger.noteEdits("A", [abs("spec.md")]);
    // Lands after A's own commit, before A reads the commits since its start.
    const commitsSince = history.commitsSince.bind(history);
    vi.spyOn(history, "commitsSince").mockImplementationOnce(async (...args) => {
      write("spec.md", "later");
      await history.commitPaths(["spec.md"], "Turn: later", { task: "t9" });
      return commitsSince(...args);
    });
    expect((await endTurn(history, ledger, a, ok, "A", { task: "t1" }))?.conflicts).toEqual([]);
    expect((await subjects()).slice(-2)).toEqual(["Turn: A\n\nTask: t1", "Turn: later\n\nTask: t9"]);
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
  });

  it("before is read ahead of the dirty snapshot: a commit still queued at the start counts as a conflict", async () => {
    write("spec.md", "0");
    await history.save("seed spec");
    const c = await beginTurn(history, ledger, "C", { task: "t3" });
    write("spec.md", "from t1");
    // Queued, not awaited: it lands after B reads the head and before B's dirty snapshot.
    const committed = history.commitPaths(["spec.md"], "Turn: t1", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    await committed;
    // In B's dirty snapshot spec.md is already clean: with `before` read after it, the t1 commit would be missed.
    expect(b.startDirty?.has("spec.md")).toBe(false);
    write("spec.md", "from B");
    ledger.noteEdits("B", [abs("spec.md")]);
    const rb = await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    expect(rb?.conflicts).toEqual([{ path: "spec.md", tasks: ["t1"] }]);
    await endTurn(history, ledger, c, ok, "C", { task: "t3" });
  });

  it("a turn that starts while an overlapped turn is still committing is not alone: no Before message takes its paths", async () => {
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });
    write("a.md", "a");
    ledger.noteEdits("A", [abs("a.md")]);
    const ra = endTurn(history, ledger, a, ok, "A", { task: "t1" });
    const c = await beginTurn(history, ledger, "C", { task: "t3" });
    expect(c.alone).toBe(false);
    await ra;
    expect(await subjects()).toEqual(["Start", "Turn: A\n\nTask: t1"]);
    await endTurn(history, ledger, c, ok, "C", { task: "t3" });
  });

  it("an edit named in NFC owns a file git names in NFD (and the reverse)", async () => {
    const nfd = "café.md";
    const nfc = "café.md";
    const a = await beginTurn(history, ledger, "A", { task: "t1" });
    const b = await beginTurn(history, ledger, "B", { task: "t2" });
    write(nfd, "a");
    ledger.noteEdits("A", [abs(nfc)]);
    const ra = await endTurn(history, ledger, a, ok, "A", { task: "t1" });
    expect(ra?.shared).toEqual([]);
    expect(ra?.owned.map((p) => p.normalize("NFC"))).toEqual([nfc]);
    expect(Object.keys(await treeOf(gitdir, await head())).map((p) => p.normalize("NFC")).sort()).toEqual([nfc, "seed.md"]);
    await endTurn(history, ledger, b, ok, "B", { task: "t2" });

    const c = await beginTurn(history, ledger, "C", { task: "t3" });
    const d = await beginTurn(history, ledger, "D", { task: "t4" });
    write("naïve.md", "c");
    ledger.noteEdits("C", [abs("naïve.md")]);
    expect((await endTurn(history, ledger, c, ok, "C", { task: "t3" }))?.owned.map((p) => p.normalize("NFC"))).toEqual(["naïve.md"]);
    await endTurn(history, ledger, d, ok, "D", { task: "t4" });
  });

  it("edits through the real path of a linked folder own the file (Claude's form) as the given form does (Codex's)", async () => {
    const real = path.join(path.dirname(folder), "real");
    fs.mkdirSync(real);
    const link = path.join(path.dirname(folder), "link");
    fs.symlinkSync(real, link);
    const h = new History(link, path.join(path.dirname(folder), "linked.git"), [".harness/"]);
    await h.init();
    await h.save("Start");
    const l = TurnLedger.forFolder(link);
    const a = await beginTurn(h, l, "A", { task: "t1" });
    const b = await beginTurn(h, l, "B", { task: "t2" });
    fs.writeFileSync(path.join(link, "x.md"), "x");
    fs.writeFileSync(path.join(link, "y.md"), "y");
    l.noteEdits("A", [path.join(fs.realpathSync(link), "x.md")]);
    l.noteEdits("B", [path.join(link, "y.md")]);
    expect(await endTurn(h, l, a, ok, "A", { task: "t1" })).toEqual({ owned: ["x.md"], shared: [], with: [], conflicts: [] });
    expect(await endTurn(h, l, b, ok, "B", { task: "t2" })).toEqual({ owned: ["y.md"], shared: [], with: [], conflicts: [] });
  });

  it("a beginTurn that fails closes its window", async () => {
    const broken = new History(folder, path.join(folder, "missing", "nothing.git"));
    vi.spyOn(broken, "save").mockRejectedValue(new Error("disk"));
    await expect(beginTurn(broken, ledger, "A", { task: "t1" })).rejects.toThrow("disk");
    expect(ledger.anyRunning()).toBe(false);
  });
});
