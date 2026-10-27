import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { recordingSchema } from "@humanharness/fake-agent";
import { Recorder, briefMatch, snapshotFolder } from "../src/record";
import { tempRoot } from "./helpers";

const { root, cleanup } = tempRoot("hh-record-");
afterAll(cleanup);

const toolFor = (name: string) => `show_${name}`;
const matchFor = (action: string) => `# Task: ${action}`;

describe("snapshotFolder", () => {
  it("keeps small text files, skips .harness, binaries and large files", async () => {
    const f = path.join(root, "snap");
    fs.mkdirSync(path.join(f, ".harness"), { recursive: true });
    fs.mkdirSync(path.join(f, "sub"));
    fs.writeFileSync(path.join(f, "a.md"), "A");
    fs.writeFileSync(path.join(f, "sub", "b.md"), "B");
    fs.writeFileSync(path.join(f, ".harness", "tasks.json"), "{}");
    fs.writeFileSync(path.join(f, "img.png"), Buffer.from([0, 1, 2]));
    fs.writeFileSync(path.join(f, "big.txt"), "x".repeat(70 * 1024));
    const snap = await snapshotFolder(f);
    expect(Object.fromEntries(snap.files)).toEqual({ "a.md": "A", "sub/b.md": "B" });
    expect([...snap.skipped].sort()).toEqual(["big.txt", "img.png"]);
  });

  it("leaves out .claude and the files the app generates", async () => {
    const f = path.join(root, "snap-app");
    fs.mkdirSync(path.join(f, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(f, ".claude", "settings.json"), "{}");
    fs.writeFileSync(path.join(f, "AGENTS.md"), "/Users/x/refs");
    fs.writeFileSync(path.join(f, "CLAUDE.md"), "c");
    fs.writeFileSync(path.join(f, "a.md"), "A");
    const snap = await snapshotFolder(f, ["AGENTS.md", "CLAUDE.md"]);
    expect(Object.fromEntries(snap.files)).toEqual({ "a.md": "A" });
  });

  it("never follows symlinks: they are skipped, not read", async () => {
    const outside = path.join(root, "outside");
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "secret.txt"), "SECRET");
    const f = path.join(root, "snap-links");
    fs.mkdirSync(f, { recursive: true });
    fs.writeFileSync(path.join(f, "a.md"), "A");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(f, "link.txt"));
    fs.symlinkSync(outside, path.join(f, "linkdir"));
    const snap = await snapshotFolder(f);
    expect(Object.fromEntries(snap.files)).toEqual({ "a.md": "A" });
    expect([...snap.skipped].sort()).toEqual(["link.txt", "linkdir"]);
  });
});

describe("briefMatch", () => {
  it("skips front matter and placeholder-only lines, and cuts at a placeholder", () => {
    expect(briefMatch("---\ntitle: x\n---\n\n{{language}}\n# Task: example {{x}}\nmore", "id")).toBe("# Task: example");
    expect(briefMatch("# Task: plain\nbody", "id")).toBe("# Task: plain");
    expect(briefMatch("{{only}}", "id")).toBe("id");
  });
});

describe("Recorder", () => {
  it("records turns, links replies through next, writes and the closing note", async () => {
    const folder = path.join(root, "work");
    fs.mkdirSync(folder, { recursive: true });
    const r = new Recorder({ folder, toolFor, matchFor, recordedWith: "claude" });
    await r.begin();
    r.event({ type: "text", delta: "Hello" });
    r.event({ type: "block", name: "choices", data: { options: [{ label: "Go deeper", followUp: "More." }] } });
    r.event({ type: "usage", inputTokens: 100, outputTokens: 10, cacheReadTokens: 5, cacheWriteTokens: 0 });
    fs.writeFileSync(path.join(folder, "idea.md"), "idea\n");
    await r.turnEnded({ action: "example", phase: "run" });
    r.reply("Go deeper");
    r.event({ type: "text", delta: "More here" });
    fs.rmSync(path.join(folder, "idea.md"));
    await r.turnEnded({ action: "example", phase: "run" });
    await r.turnEnded({ action: "example", phase: "close" });
    r.note({ title: "Idea", summary: ["one"], decisions: [], files: [], open: [] });

    const [rec] = r.recordings();
    expect(recordingSchema.parse(rec)).toEqual(rec);
    expect(rec).toMatchObject({ action: "example", match: "# Task: example", recordedWith: "claude" });
    expect(rec.turns).toEqual([
      {
        id: "t1",
        text: "Hello",
        blocks: [{ tool: "show_choices", input: { options: [{ label: "Go deeper", followUp: "More." }] } }],
        writes: [{ path: "idea.md", content: "idea\n" }],
        usage: { input: 100, output: 10, cacheRead: 5, cacheWrite: 0 },
        next: { "Go deeper": "t2" },
      },
      { id: "t2", text: "More here", blocks: [], writes: [{ path: "idea.md", content: null }] },
      { id: "close", text: "", blocks: [], writes: [], note: { title: "Idea", summary: ["one"], decisions: [], files: [], open: [] } },
    ]);
  });

  it("a checkpoint is not a turn, and a new action starts its own recording", async () => {
    const folder = path.join(root, "work2");
    fs.mkdirSync(folder, { recursive: true });
    const r = new Recorder({ folder, toolFor, matchFor, recordedWith: "codex" });
    await r.begin();
    r.event({ type: "text", delta: "A" });
    await r.turnEnded({ action: "one", phase: "run" });
    // The real order: the turn ends (recordUsage), then its note is written.
    await r.turnEnded({ action: "one", phase: "checkpoint" });
    r.note({ title: "cp", summary: [] });
    r.reply("*");
    r.event({ type: "text", delta: "B" });
    await r.turnEnded({ action: "one", phase: "run" });
    await r.turnEnded({ action: "one", phase: "close" });
    r.note({ title: "final", summary: [] });
    r.event({ type: "text", delta: "C" });
    await r.turnEnded({ action: "two", phase: "run" });
    const recs = r.recordings();
    expect(recs.map((x) => x.action)).toEqual(["one", "two"]);
    expect(recs[0].turns.map((t) => t.id)).toEqual(["t1", "t2", "close"]);
    expect(recs[0].turns[0].next).toEqual({ "*": "t2" });
    expect(recs[0].turns[1].note).toBeUndefined();
    expect(recs[0].turns[2].note).toEqual({ title: "final", summary: [] });
    expect(recs[1].turns.map((t) => t.text)).toEqual(["C"]);
  });

  it("a note saved during a run turn belongs to that turn", async () => {
    const folder = path.join(root, "work-runnote");
    fs.mkdirSync(folder, { recursive: true });
    const r = new Recorder({ folder, toolFor, matchFor, recordedWith: "claude" });
    await r.begin();
    await r.turnEnded({ action: "a", task: "k1", phase: "run" });
    r.note({ title: "mid", summary: [] });
    expect(r.recordings()[0].turns[0].note).toEqual({ title: "mid", summary: [] });
  });

  it("records only the first visit of an action, and says so once", async () => {
    const folder = path.join(root, "work-twice");
    fs.mkdirSync(folder, { recursive: true });
    const warnings: string[] = [];
    const r = new Recorder({ folder, toolFor, matchFor, recordedWith: "claude", warn: (m) => warnings.push(m) });
    await r.begin();
    r.event({ type: "text", delta: "first" });
    await r.turnEnded({ action: "a", task: "k1", phase: "run" });
    await r.turnEnded({ action: "a", task: "k1", phase: "close" });
    r.note({ title: "one", summary: [] });
    r.event({ type: "text", delta: "again" });
    await r.turnEnded({ action: "a", task: "k2", phase: "run" });
    await r.turnEnded({ action: "a", task: "k2", phase: "close" });
    r.note({ title: "two", summary: [] });
    const [rec] = r.recordings();
    expect(rec.turns.map((t) => t.text)).toEqual(["first", ""]);
    expect(rec.turns[1].note?.title).toBe("one");
    expect(warnings).toHaveLength(1);
  });

  it("a phase change turn is recorded with setPhase, a wrap-up with timeUp; neither is linked by next", async () => {
    const folder = path.join(root, "rec-phases");
    fs.mkdirSync(folder, { recursive: true });
    const r = new Recorder({ folder, toolFor, matchFor, recordedWith: "claude" });
    await r.begin();
    r.event({ type: "text", delta: "Recall?" });
    await r.turnEnded({ action: "session", task: "t1", phase: "run", taskPhase: "warmup" });
    r.event({ type: "text", delta: "Main now." });
    await r.turnEnded({ action: "session", task: "t1", phase: "phase-change", taskPhase: "main" });
    r.reply("*");
    r.event({ type: "text", delta: "Sure." });
    await r.turnEnded({ action: "session", task: "t1", phase: "run", taskPhase: "main" });
    r.event({ type: "text", delta: "Wrap up." });
    await r.turnEnded({ action: "session", task: "t1", phase: "wrap-up", taskPhase: "main" });
    const [rec] = r.recordings();
    expect(rec.turns.map((t) => ({ id: t.id, setPhase: t.setPhase, timeUp: t.timeUp, next: t.next }))).toEqual([
      { id: "t1", setPhase: undefined, timeUp: undefined, next: undefined },
      { id: "t2", setPhase: "main", timeUp: undefined, next: { "*": "t3" } },
      { id: "t3", setPhase: undefined, timeUp: undefined, next: undefined },
      { id: "t4", setPhase: undefined, timeUp: true, next: undefined },
    ]);
    expect(recordingSchema.safeParse(rec).success).toBe(true);
  });

  it("lists only skipped files that are new or changed during the run", async () => {
    const folder = path.join(root, "work-skipped");
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, "old.png"), Buffer.from([0, 1]));
    const r = new Recorder({ folder, toolFor, matchFor, recordedWith: "claude" });
    await r.begin();
    fs.writeFileSync(path.join(folder, "new.png"), Buffer.from([0, 2, 3]));
    await r.turnEnded({ action: "a", task: "k", phase: "run" });
    expect([...r.skipped]).toEqual(["new.png"]);
  });

  it("a failed turn is not recorded, and the retry is linked by the same reply", async () => {
    const folder = path.join(root, "work3");
    fs.mkdirSync(folder, { recursive: true });
    const r = new Recorder({ folder, toolFor, matchFor, recordedWith: "claude" });
    await r.begin();
    r.event({ type: "text", delta: "First" });
    await r.turnEnded({ action: "a", phase: "run" });
    r.reply("Go");
    r.event({ type: "text", delta: "half" });
    r.event({ type: "usage", inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 });
    fs.writeFileSync(path.join(folder, "x.md"), "x");
    await r.turnEnded({ action: "a", phase: "run" }, { failed: true });
    r.event({ type: "text", delta: "retry" });
    await r.turnEnded({ action: "a", phase: "run" });
    const [rec] = r.recordings();
    expect(rec.turns.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(rec.turns[0].next).toEqual({ Go: "t2" });
    expect(rec.turns[1]).toEqual({ id: "t2", text: "retry", blocks: [], writes: [{ path: "x.md", content: "x" }] });
  });
});

describe("Recorder: answers", () => {
  it("links the answer given to a turn's input block to the next turn, under respond", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-rec-"));
    try {
      const r = new Recorder({ folder, toolFor: (b) => `show_${b}`, matchFor: () => "# Task: practice", recordedWith: "claude" });
      await r.begin();
      r.event({ type: "block", name: "commit_answer", data: { question: "Who?" }, id: "t1:0:0" });
      await r.turnEnded({ action: "practice", task: "t1", phase: "run" });
      r.answer("commit_answer", { choice: "Me", why: "x" });
      r.event({ type: "text", delta: "Right." });
      await r.turnEnded({ action: "practice", task: "t1", phase: "run" });
      const [rec] = r.recordings();
      expect(rec.turns[0].respond).toEqual([{ block: "commit_answer", value: { choice: "Me", why: "x" }, next: "t2" }]);
      expect(rec.turns[0].next).toBeUndefined();
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  it("a follow-up typed after an answer whose turn failed is linked as the follow-up, not the answer", async () => {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), "hh-rec-"));
    try {
      const r = new Recorder({ folder, toolFor: (b) => `show_${b}`, matchFor: () => "# Task: practice", recordedWith: "claude" });
      await r.begin();
      r.event({ type: "block", name: "commit_answer", data: { question: "Who?" }, id: "t1:0:0" });
      await r.turnEnded({ action: "practice", task: "t1", phase: "run" });
      r.answer("commit_answer", { choice: "Me", why: "x" });
      await r.turnEnded({ action: "practice", task: "t1", phase: "run" }, { failed: true });
      r.reply("*");
      r.event({ type: "text", delta: "Sure." });
      await r.turnEnded({ action: "practice", task: "t1", phase: "run" });
      const [rec] = r.recordings();
      expect(rec.turns[0].next).toEqual({ "*": "t2" });
      expect(rec.turns[0].respond).toBeUndefined();
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
