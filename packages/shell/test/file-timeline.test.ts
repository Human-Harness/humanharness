import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History, MAX_DIFF_BYTES, REVIEWS_PREFIX, blobId } from "@humanharness/workspace";
import { limitDiffs, workerDiff } from "../src/main/diff-runner";
import { FileTimelineService } from "../src/main/file-timeline";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-fts-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const DOC = "specs/filter.md";
let folder: string;
let history: History;
let busy: boolean;
let restored: number;
let approvals: { blob: string; at: string; reason?: string }[];
let svc: FileTimelineService;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "history.git"), [".harness/", "AGENTS.md"], [REVIEWS_PREFIX]);
  await history.init();
  busy = false;
  restored = 0;
  approvals = [];
  svc = new FileTimelineService({
    base: async () => folder,
    history: async () => history,
    actionLabel: (id) => (id === "spec" ? "Spec writer" : "A question"),
    approvals: async () => approvals,
    busy: () => busy,
    restore: async (run) => void (await run(history)),
    restored: () => void restored++,
  });
});

async function writeSpec() {
  await history.save("Start");
  write(DOC, "## Scope\n\nFilter by size.\n");
  const t1 = (await history.save("Turn: write", { task: "t1", action: "spec" }))!;
  write(DOC, "## Scope\n\nFilter by size and colour.\n");
  const t2 = (await history.save("Turn: edit", { task: "t2", action: "spec" }))!;
  return { t1, t2 };
}

describe("FileTimelineService (file-timeline spec §3–§5)", () => {
  it("refuses bad, outside and untracked paths, as data", async () => {
    expect(await svc.timeline("../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await svc.timeline("/etc/passwd")).toEqual({ ok: false, reason: "outside" });
    expect(await svc.timeline(42)).toEqual({ ok: false, reason: "outside" });
    expect(await svc.timeline(".harness/tasks.json")).toEqual({ ok: false, reason: "untracked" });
    expect(await svc.timeline("AGENTS.md")).toEqual({ ok: false, reason: "untracked" });
    expect(await svc.timeline("new.md")).toEqual({ ok: true, entries: [] });
  });

  it("not ready without a folder or a history", async () => {
    const off = new FileTimelineService({ base: async () => null, history: async () => null, actionLabel: () => "", approvals: async () => [], busy: () => false, restore: async () => undefined, restored: () => undefined });
    expect(await off.timeline(DOC)).toEqual({ ok: false, reason: "not-ready" });
  });

  it("the timeline, normalised path, with an approval's reason", async () => {
    const { t2 } = await writeSpec();
    write(`${REVIEWS_PREFIX}${DOC}.json`, "{}");
    await history.save(`Approved: ${DOC}`, { task: "t2", action: "spec" });
    approvals = [{ blob: blobId(fs.readFileSync(path.join(folder, DOC))), at: "2026-10-28T10:00:00.000Z", reason: "Decided on the call" }];
    const r = await svc.timeline(`./specs//filter.md`);
    if (!r.ok) throw new Error(r.reason);
    expect(r.entries.map((e) => [e.kind, e.author.label])).toEqual([
      ["approval", "You"],
      ["task", "Spec writer"],
      ["task", "Spec writer"],
    ]);
    expect(r.entries[0].reason).toBe(true);
    expect(r.entries[0].lastApproved).toBe(true);
    expect(r.entries[1].to).toBe(t2);
  });

  it("approvals pair with the record by blob: after a whole-folder go-back, the record's last approval is v1", async () => {
    await history.save("Start");
    const approve = async (text: string, reason?: string) => {
      write(DOC, text);
      await history.save("Turn: write", { task: "t1", action: "spec" });
      const blob = blobId(fs.readFileSync(path.join(folder, DOC)));
      approvals = [...approvals, { blob, at: "2026-10-28T10:00:00.000Z", ...(reason ? { reason } : {}) }];
      write(`${REVIEWS_PREFIX}${DOC}.json`, JSON.stringify(approvals));
      return (await history.save(`Approved: ${DOC}`, { task: "t1", action: "spec" }))!;
    };
    const v1 = await approve("## Scope\n\nFilter by size.\n", "First call");
    const before = approvals;
    await approve("## Scope\n\nFilter by size and colour.\n");
    // The whole folder back to v1: the document and its review record (which then holds v1 only).
    await history.restore(v1, "Went back to an earlier point");
    approvals = before;
    const r = await svc.timeline(DOC);
    if (!r.ok) throw new Error(r.reason);
    const marks = r.entries.filter((e) => e.kind === "approval").map((e) => [e.version, e.reason ?? false, e.lastApproved ?? false]);
    expect(marks).toEqual([
      [2, false, false],
      [1, true, true],
    ]);
    // A record that names no version on the timeline marks nothing.
    approvals = [{ blob: "b".repeat(40), at: "2026-10-28T10:00:00.000Z", reason: "Elsewhere" }];
    const none = await svc.timeline(DOC);
    if (!none.ok) throw new Error(none.reason);
    expect(none.entries.some((e) => e.reason || e.lastApproved)).toBe(false);
  });

  it("a diff between two commits, and against the current file", async () => {
    const { t1, t2 } = await writeSpec();
    const here = await svc.diff(DOC, t1, t2);
    expect(here).toMatchObject({ ok: true, kind: "markdown", same: false });
    write(DOC, "## Scope\n\nFilter by size and colour.\n");
    expect(await svc.diff(DOC, t2, "current")).toMatchObject({ ok: true, same: true });
    expect(await svc.diff(DOC, null, t1)).toMatchObject({ ok: true, kind: "markdown" });
    expect(await svc.diff(DOC, "nope", t1)).toEqual({ ok: false, reason: "bad-input" });
    fs.rmSync(path.join(folder, DOC));
    expect(await svc.diff(DOC, t2, "current")).toMatchObject({ ok: true, same: false });
  });

  it("the current side never follows a link out of the folder", async () => {
    const { t2 } = await writeSpec();
    const outside = path.join(root, "secret.md");
    fs.writeFileSync(outside, "secret");
    fs.rmSync(path.join(folder, DOC));
    fs.symlinkSync(outside, path.join(folder, DOC));
    expect(await svc.diff(DOC, t2, "current")).toEqual({ ok: false, reason: "outside" });
  });

  it("restore: a prompt for an entry's version, then one file back, untagged, with its own commit", async () => {
    const { t1 } = await writeSpec();
    expect(await svc.restorePrompt(DOC, "f".repeat(40))).toEqual({ ok: false, reason: "not-found" });
    const p = await svc.restorePrompt(DOC, t1);
    expect(p).toMatchObject({ ok: true, prompt: { path: DOC, author: { label: "Spec writer" }, kind: "task" } });
    expect(await svc.restore(DOC, t1)).toEqual({ ok: true });
    expect(fs.readFileSync(path.join(folder, DOC), "utf8")).toBe("## Scope\n\nFilter by size.\n");
    expect(restored).toBe(1);
    const r = await svc.timeline(DOC);
    if (!r.ok) throw new Error(r.reason);
    expect(r.entries[0]).toMatchObject({ kind: "goBack", author: { kind: "person" }, back: { at: expect.any(String) } });
    expect(r.entries[0].commits[0].subject.startsWith(`Go back: ${DOC} to the version of `)).toBe(true);
  });

  it("restore is refused while a turn runs, and a deleted entry can't be the target", async () => {
    const { t1 } = await writeSpec();
    busy = true;
    expect(await svc.restorePrompt(DOC, t1)).toEqual({ ok: false, reason: "busy" });
    expect(await svc.restore(DOC, t1)).toEqual({ ok: false, reason: "busy" });
    busy = false;
    fs.rmSync(path.join(folder, DOC));
    const gone = (await history.save("Turn: remove", { task: "t3" }))!;
    expect(await svc.restorePrompt(DOC, gone)).toEqual({ ok: false, reason: "deleted" });
    expect(await svc.restore(DOC, t1)).toEqual({ ok: true });
    expect(fs.existsSync(path.join(folder, DOC))).toBe(true);
  });

  it("a shape refused before the history is asked for; a commit not on this path's timeline is never read", async () => {
    const { t1 } = await writeSpec();
    let asked = 0;
    const counting = new FileTimelineService({ base: async () => folder, history: async () => (asked++, history), actionLabel: () => "", approvals: async () => [], busy: () => false, restore: async () => undefined, restored: () => undefined });
    expect(await counting.timeline("../x.md")).toEqual({ ok: false, reason: "outside" });
    expect(await counting.diff("a\0b", t1, "current")).toEqual({ ok: false, reason: "outside" });
    expect(asked).toBe(0);
    write("other.md", "other");
    const other = (await history.save("Turn: other", { task: "t9" }))!;
    let read = 0;
    const readBytesAt = history.readBytesAt.bind(history);
    history.readBytesAt = (...a) => (read++, readBytesAt(...a));
    expect(await svc.diff(DOC, other, "current")).toEqual({ ok: false, reason: "not-found" });
    expect(await svc.diff(DOC, t1, other)).toEqual({ ok: false, reason: "not-found" });
    expect(await svc.restorePrompt(DOC, other)).toEqual({ ok: false, reason: "not-found" });
    expect(await svc.restore(DOC, other)).toEqual({ ok: false, reason: "not-found" });
    expect(read).toBe(0);
  });

  it("same comes from the blob ids: two big files equal up to the cap are not the same", async () => {
    await history.save("Start");
    const head = "x".repeat(MAX_DIFF_BYTES + 100);
    write("big.txt", `${head}a`);
    const a = (await history.save("Turn: a", { task: "t1" }))!;
    write("big.txt", `${head}b`);
    const b = (await history.save("Turn: b", { task: "t2" }))!;
    expect(await svc.diff("big.txt", a, b)).toMatchObject({ ok: true, kind: "text", same: false, truncated: true });
    expect(await svc.diff("big.txt", b, "current")).toMatchObject({ ok: true, same: true, truncated: true });
    write("big.txt", `${head}c`);
    expect(await svc.diff("big.txt", b, "current")).toMatchObject({ ok: true, same: false, truncated: true });
  });

  it("the timeline is cached per path until the path gets a new commit", async () => {
    await writeSpec();
    let built = 0;
    const fileTimeline = history.fileTimeline.bind(history);
    history.fileTimeline = (...a) => (built++, fileTimeline(...a));
    const first = await svc.timeline(DOC);
    if (!first.ok) throw new Error(first.reason);
    first.entries[0].author.label = "changed by the caller";
    expect(await svc.timeline(DOC)).toMatchObject({ ok: true, entries: [{ author: { label: "Spec writer" } }, {}] });
    write("elsewhere.md", "x");
    await history.save("Turn: elsewhere", { task: "t3" });
    await svc.timeline(DOC);
    expect(built).toBe(1);
    write(DOC, "## Scope\n\nAgain.\n");
    await history.save("Turn: again", { task: "t4", action: "spec" });
    const r = await svc.timeline(DOC);
    expect(built).toBe(2);
    expect(r.ok && r.entries.length).toBe(3);
  });

  it("a throw inside answers failed, as data", async () => {
    await writeSpec();
    history.fileTimeline = async () => {
      throw new Error("broken history");
    };
    expect(await svc.timeline(DOC)).toEqual({ ok: false, reason: "failed" });
    const crashing = new FileTimelineService({ base: async () => folder, history: async () => history, actionLabel: () => "", approvals: async () => [], busy: () => false, restore: async () => undefined, restored: () => undefined, diff: async () => null });
    expect(await crashing.diff("new.txt", null, "current")).toEqual({ ok: false, reason: "failed" });
  });

  it("a Markdown diff the worker couldn't finish shows as plain lines, computed here", async () => {
    const { t1, t2 } = await writeSpec();
    const failing = new FileTimelineService({ base: async () => folder, history: async () => history, actionLabel: () => "", approvals: async () => [], busy: () => false, restore: async () => undefined, restored: () => undefined, diff: async () => null });
    const r = await failing.diff(DOC, t1, t2);
    expect(r).toMatchObject({ ok: true, kind: "text", lang: "md", same: false });
    if (!r.ok || r.kind !== "text") throw new Error("not text");
    expect(r.lines.filter((l) => l.kind !== "same").map((l) => [l.kind, l.text])).toEqual([
      ["del", "Filter by size."],
      ["ins", "Filter by size and colour."],
    ]);
  });

  it("the diff runs in a worker thread when the app gives one", async () => {
    const { t1, t2 } = await writeSpec();
    const inWorker = new FileTimelineService({ base: async () => folder, history: async () => history, actionLabel: () => "", approvals: async () => [], busy: () => false, restore: async () => undefined, restored: () => undefined, diff: workerDiff() });
    const r = await inWorker.diff(DOC, t1, t2);
    expect(r).toMatchObject({ ok: true, kind: "markdown", same: false });
    if (!r.ok || r.kind !== "markdown") throw new Error("no diff");
    expect(r.blocks.some((b) => b.status === "changed")).toBe(true);
    // A worker that can't finish in time answers null, never hangs.
    expect(await workerDiff({ timeoutMs: 1 })(DOC, { kind: "absent" }, { kind: "absent" })).toBeNull();
  }, 20_000);

  it("the current side of a link inside the folder is refused, never read through", async () => {
    const { t2 } = await writeSpec();
    write("specs/target.md", "## Scope\n\nFilter by size and colour.\n");
    fs.rmSync(path.join(folder, DOC));
    fs.symlinkSync("target.md", path.join(folder, DOC));
    expect(await svc.diff(DOC, t2, "current")).toEqual({ ok: false, reason: "unsafe" });
    // A folder on the way that is a link, too.
    write("real/notes.txt", "x");
    await history.save("Turn: notes", { task: "t5" });
    const notes = await svc.timeline("real/notes.txt");
    if (!notes.ok) throw new Error(notes.reason);
    fs.renameSync(path.join(folder, "real"), path.join(folder, "elsewhere"));
    fs.symlinkSync("elsewhere", path.join(folder, "real"));
    expect(await svc.diff("real/notes.txt", notes.entries[0].to, "current")).toEqual({ ok: false, reason: "unsafe" });
  });
});

describe("limitDiffs: workers at once, and a bounded wait (file-timeline spec §4)", () => {
  const view = { ok: true as const, kind: "binary" as const, same: true, sizes: { before: null, after: null } };
  const none = { kind: "absent" as const };

  it("runs at most `atOnce`; up to `waiting` wait in order; any more answer null at once", async () => {
    let running = 0;
    let most = 0;
    const order: string[] = [];
    const gates: (() => void)[] = [];
    const run = limitDiffs(
      (file, _b, _a, release) =>
        new Promise((resolve) => {
          running++;
          most = Math.max(most, running);
          order.push(file);
          gates.push(() => {
            running--;
            release();
            resolve(view);
          });
        }),
      { atOnce: 2, waiting: 2 },
    );
    const calls = ["a", "b", "c", "d"].map((f) => run(f, none, none));
    expect(await run("e", none, none)).toBeNull();
    await Promise.resolve();
    expect(order).toEqual(["a", "b"]);
    gates.shift()!();
    await calls[0];
    await new Promise((r) => setTimeout(r, 0));
    expect(order).toEqual(["a", "b", "c"]);
    while (gates.length > 0) {
      gates.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(await Promise.all(calls)).toEqual([view, view, view, view]);
    expect(order).toEqual(["a", "b", "c", "d"]);
    expect(most).toBe(2);
    // The places all came back.
    const f = run("f", none, none);
    await Promise.resolve();
    expect(order.at(-1)).toBe("f");
    gates.shift()!();
    expect(await f).toEqual(view);
  });

  it("a diff that throws gives its place back", async () => {
    const run = limitDiffs(async () => {
      throw new Error("boom");
    }, { atOnce: 1, waiting: 0 });
    await expect(run("a", none, none)).rejects.toThrow("boom");
    await expect(run("b", none, none)).rejects.toThrow("boom");
  });
});
