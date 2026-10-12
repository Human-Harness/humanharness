import { describe, expect, it } from "vitest";
import { type ChatState, initialChat, reduceChat } from "../src/state";

const run = (events: Parameters<typeof reduceChat>[1][], from: ChatState = initialChat([])) => events.reduce(reduceChat, from);

describe("reduceChat", () => {
  it("ignores context and compaction events: they reach the screen through the task view", () => {
    const s = initialChat([]);
    expect(reduceChat(s, { type: "context", used: 5 })).toBe(s);
    expect(reduceChat(s, { type: "compaction" })).toBe(s);
  });

  it("tags a finished turn (and a failure without one) with the task it ended in", () => {
    const s = run([{ type: "user", text: "hi", at: "t" }, { type: "done", ok: true, task: "t1" }, { type: "done", ok: false, error: { code: "agent-crashed" }, task: "t2" }]);
    expect(s.entries.map((e) => [e.role, e.task])).toEqual([
      ["user", undefined],
      ["assistant", "t1"],
      ["assistant", "t2"],
    ]);
  });

  it("adds the user's message and starts a live turn", () => {
    const s = run([{ type: "user", text: "hi", at: "2026-10-10T00:00:00Z" }]);
    expect(s.entries.map((e) => [e.role, e.text])).toEqual([["user", "hi"]]);
    expect(s.live).toEqual({ text: "", blocks: [], activities: [] });
  });

  it("streams text, paragraphs, activities and visible blocks into the live turn", () => {
    const s = run([
      { type: "user", text: "hi", at: "t" },
      { type: "text", delta: "Hel" },
      { type: "text", delta: "lo" },
      { type: "activity", id: "a", kind: "read", detail: "x.md", state: "start" },
      { type: "activity", id: "a", kind: "read", detail: "x.md", state: "end", error: false },
      { type: "paragraph" },
      { type: "text", delta: "Done" },
      { type: "block", name: "note", data: { title: "T" } },
    ]);
    expect(s.live).toEqual({
      text: "Hello\n\nDone",
      blocks: [{ name: "note", data: { title: "T" } }],
      activities: [{ id: "a", kind: "read", detail: "x.md", done: true, error: false }],
    });
  });

  it("keeps state blocks out of the conversation", () => {
    const s = run([{ type: "user", text: "hi", at: "t" }, { type: "block", name: "progress", data: { percent: 5 } }], {
      ...initialChat([]),
      stateBlocks: new Set(["progress"]),
    });
    expect(s.live?.blocks).toEqual([]);
    expect(s.blockState).toEqual({ progress: { percent: 5 } });
  });

  it("closes the turn into an assistant entry on done, with the error if any", () => {
    const s = run([
      { type: "user", text: "hi", at: "t" },
      { type: "text", delta: "partial" },
      { type: "done", ok: false, error: { code: "out-of-quota" } },
    ]);
    expect(s.live).toBeNull();
    expect(s.entries.at(-1)).toMatchObject({ role: "assistant", text: "partial", error: { code: "out-of-quota" } });
  });

  it("shows a failure that arrives without a turn on screen (a quiet closing turn) as an error entry", () => {
    const s = run([{ type: "done", ok: false, error: { code: "session-expired" } }, { type: "done", ok: true }]);
    expect(s.entries).toEqual([
      { id: expect.any(String), role: "assistant", text: "", blocks: [], activities: [], at: expect.any(String), error: { code: "session-expired" } },
    ]);
  });

  it("remembers the latest plan limits", () => {
    const windows = [{ kind: "five_hour", utilization: 0.2, resetsAt: "2026-10-10T18:00:00.000Z" }];
    const s = run([{ type: "limits", status: "allowed", windows }]);
    expect(s.limits).toEqual(windows);
  });

  it("merges loaded entries before the ones already in state", () => {
    const saved = { id: "1", role: "user" as const, text: "old", blocks: [], activities: [], at: "t" };
    const s = run([{ type: "user", text: "new", at: "t" }, { type: "loaded", entries: [saved] }]);
    expect(s.entries.map((e) => e.text)).toEqual(["old", "new"]);
    expect(run([{ type: "loaded", entries: [saved] }, { type: "loaded", entries: [saved] }]).entries).toHaveLength(1);
  });

  it("adds a local notice as an assistant entry without starting a turn", () => {
    const s = run([{ type: "notice", text: "restored", at: "t" }]);
    expect(s.entries.map((e) => [e.role, e.text])).toEqual([["assistant", "restored"]]);
    expect(s.live).toBeNull();
  });

  it("keeps the action, tokens, limits and state blocks on the entries", () => {
    const windows = [{ kind: "five_hour", utilization: 0.3, resetsAt: "2026-10-11T15:00:00.000Z" }];
    const s = run(
      [
        { type: "user", text: "hi", at: "t", action: "tidy" },
        { type: "block", name: "progress", data: { percent: 10 } },
        { type: "limits", status: "allowed", windows },
        { type: "usage", inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
        { type: "done", ok: true },
      ],
      { ...initialChat([]), stateBlocks: new Set(["progress"]) },
    );
    expect(s.entries[0]).toMatchObject({ role: "user", action: "tidy" });
    expect(s.entries[1]).toMatchObject({
      usage: { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4 },
      limits: windows,
      state: { progress: { percent: 10 } },
    });
  });

  it("restores state blocks from the saved conversation; newer live data wins", () => {
    const saved = [
      { id: "1", role: "assistant" as const, text: "", blocks: [], activities: [], at: "t", state: { progress: { percent: 20 }, phase: { n: 1 } } },
      { id: "2", role: "assistant" as const, text: "", blocks: [], activities: [], at: "t", state: { progress: { percent: 60 } } },
    ];
    const s = run([{ type: "loaded", entries: saved }], { ...initialChat([]), blockState: { phase: { n: 2 } } });
    expect(s.blockState).toEqual({ progress: { percent: 60 }, phase: { n: 2 } });
  });
});
