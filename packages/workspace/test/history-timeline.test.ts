import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { History, REVIEWS_PREFIX } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-tl-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let folder: string;
let history: History;
const write = (rel: string, content: string) => {
  fs.mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  fs.writeFileSync(path.join(folder, rel), content);
};
const label = (id: string | null) => (id === "spec" ? "Spec writer" : "A question");
const DOC = "specs/filter.md";

beforeEach(async () => {
  const base = fs.mkdtempSync(path.join(root, "t-"));
  folder = path.join(base, "work");
  fs.mkdirSync(folder);
  history = new History(folder, path.join(base, "history.git"), [".harness/", "AGENTS.md"], [REVIEWS_PREFIX]);
  await history.init();
});

describe("History.fileTimeline (file-timeline spec §3)", () => {
  it("an agent's task, the person's answer, an approval, an outside change and a restore", async () => {
    await history.save("Start");
    await history.save("Before message", { task: "t1", action: "spec" });
    write(DOC, "Filter by size.\n");
    const turn = (await history.save("Turn: write the spec", { task: "t1", action: "spec" }))!;
    write(DOC, "Filter by size and colour.\n");
    await history.save(`Answer: ${DOC} · Size only?`, { task: "t1", action: "spec" });
    write(`${REVIEWS_PREFIX}${DOC}.json`, "{}");
    await history.save(`Approved: ${DOC}`, { task: "t1", action: "spec" });
    write(DOC, "Filter by colour.\n");
    await history.save("Before message", { task: "t2" });
    await history.restore(turn, "Went back to an earlier point");
    const entries = await history.fileTimeline(DOC, label);
    expect(entries.map((e) => [e.kind, e.author.label])).toEqual([
      ["goBack", "You"],
      ["outside", "Outside the app"],
      ["approval", "You"],
      ["answers", "You"],
      ["task", "Spec writer"],
    ]);
    expect(entries[0].back).toEqual({ at: entries[4].at });
    expect(entries[2].version).toBe(1);
    expect(entries[4].from).not.toBeNull();
    expect(await history.readBytesAt(entries[4].from!, DOC)).toBeNull();
    expect((await history.readBytesAt(entries[4].to, DOC))?.bytes.toString()).toBe("Filter by size.\n");
  });

  it("a deleted file ends with a Deleted entry; nothing yet: no entries", async () => {
    expect(await history.fileTimeline(DOC, label)).toEqual([]);
    write(DOC, "x");
    await history.save("Turn: write", { task: "t1" });
    fs.rmSync(path.join(folder, DOC));
    await history.save("Turn: remove", { task: "t2" });
    const [gone, made] = await history.fileTimeline(DOC, label);
    expect(gone.deleted).toBe(true);
    expect(made.deleted).toBeUndefined();
  });

  it("reads at most `max` commits, the newest", async () => {
    for (let i = 0; i < 5; i++) {
      write("a.md", String(i));
      await history.save(`Turn: ${i}`, { task: `t${i}` });
    }
    const entries = await history.fileTimeline("a.md", label, 3);
    expect(entries.map((e) => e.commits[0].subject)).toEqual(["Turn: 4", "Turn: 3", "Turn: 2"]);
  });

  it("readBytesAt keeps at most `max` bytes, with the whole size and the blob id", async () => {
    write(DOC, "0123456789");
    const sha = (await history.save("Turn: write", { task: "t1" }))!;
    const all = await history.readBytesAt(sha, DOC);
    expect(all?.bytes.toString()).toBe("0123456789");
    const cut = await history.readBytesAt(sha, DOC, 4);
    expect(cut).toEqual({ bytes: Buffer.from("0123"), size: 10, oid: all!.oid });
    // The prefix is a copy: it does not keep a big blob's memory alive.
    write(DOC, "x".repeat(100_000));
    const big = (await history.save("Turn: grow", { task: "t1" }))!;
    expect((await history.readBytesAt(big, DOC, 4))!.bytes.buffer.byteLength).toBeLessThan(100_000);
    expect(await history.readBytesAt(sha, "nope.md", 4)).toBeNull();
  });
});
