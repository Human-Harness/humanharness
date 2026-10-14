// packages/cli/test/record.test.ts
import fs from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { recordingSchema } from "@humanharness/fake-agent";
import { Recorder, snapshotFolder } from "../src/record";
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
    r.note({ title: "Idea", summary: ["one"], decisions: [], files: [], open: [] });
    await r.turnEnded({ action: "example", phase: "close" });

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
    r.note({ title: "cp", summary: [] });
    await r.turnEnded({ action: "one", phase: "checkpoint" });
    r.reply("*");
    r.event({ type: "text", delta: "B" });
    await r.turnEnded({ action: "one", phase: "run" });
    await r.turnEnded({ action: "one", phase: "close" });
    r.event({ type: "text", delta: "C" });
    await r.turnEnded({ action: "two", phase: "run" });
    const recs = r.recordings();
    expect(recs.map((x) => x.action)).toEqual(["one", "two"]);
    // The closing note may also come after the closing turn ended.
    const late = new Recorder({ folder, toolFor, matchFor, recordedWith: "claude" });
    await late.begin();
    await late.turnEnded({ action: "one", phase: "run" });
    await late.turnEnded({ action: "one", phase: "close" });
    late.note({ title: "late", summary: [] });
    expect(late.recordings()[0].turns[1].note).toEqual({ title: "late", summary: [] });
    expect(recs[0].turns.map((t) => t.id)).toEqual(["t1", "t2", "close"]);
    expect(recs[0].turns[0].next).toEqual({ "*": "t2" });
    expect(recs[0].turns[2].note).toEqual({ title: "cp", summary: [] });
    expect(recs[1].turns.map((t) => t.text)).toEqual(["C"]);
  });
});
