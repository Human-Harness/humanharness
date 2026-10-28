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
    expect(s.live).toEqual({ id: expect.any(String), text: "", blocks: [], parts: [], activities: [] });
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
      id: expect.any(String),
      text: "Hello\n\nDone",
      blocks: [{ name: "note", data: { title: "T" } }],
      parts: [{ text: "Hello\n\nDone" }, { block: 0 }],
      activities: [{ id: "a", kind: "read", detail: "x.md", done: true, error: false }],
    });
  });

  it("keeps text and blocks in the order they arrived, and the entry keeps the live turn's id", () => {
    const s = run([
      { type: "user", text: "hi", at: "t" },
      { type: "text", delta: "  " },
      { type: "block", name: "diagram", data: 1 },
      { type: "paragraph" },
      { type: "text", delta: "First." },
      { type: "block", name: "files", data: 2 },
      { type: "text", delta: " Then" },
      { type: "paragraph" },
      { type: "text", delta: "more. " },
    ]);
    expect(s.live?.parts).toEqual([{ block: 0 }, { text: "First." }, { block: 1 }, { text: "Then\n\nmore. " }]);
    const id = s.live!.id;
    const done = reduceChat(s, { type: "done", ok: true });
    expect(done.entries.at(-1)).toMatchObject({ id, text: "First. Then\n\nmore.", parts: [{ block: 0 }, { text: "First." }, { block: 1 }, { text: "Then\n\nmore." }] });
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
    expect(s.entries[1].usage).not.toHaveProperty("costUsd");
  });

  it("keeps the turn's cost on the live entry when the engine reported one", () => {
    const s = run([
      { type: "user", text: "hi", at: "t" },
      { type: "usage", inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01 },
      { type: "done", ok: true },
    ]);
    expect(s.entries[1].usage).toEqual({ inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0.01 });
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

describe("input blocks", () => {
  it("a live block keeps its id into the saved entry, and an answer marks it once", () => {
    let s = run([
      { type: "user", text: "go", at: "t" },
      { type: "block", name: "commit_answer", data: { question: "q" }, id: "t1:0:0" },
      { type: "block", name: "card", data: {} },
      { type: "done", ok: true },
    ]);
    expect(s.entries[1].blocks).toEqual([{ name: "commit_answer", data: { question: "q" }, id: "t1:0:0" }, { name: "card", data: {} }]);
    const answer = { blockId: "t1:0:0", value: { why: "x" }, answeredAt: "a" };
    s = reduceChat(s, { type: "answered", answer });
    expect(s.entries[1].blocks[0].input).toEqual(answer);
    expect(s.entries[1].blocks[1]).toEqual({ name: "card", data: {} });
    // A reopened question's second answer replaces the first.
    const second = { ...answer, value: { why: "y" } };
    s = reduceChat(s, { type: "answered", answer: second });
    expect(s.entries[1].blocks[0].input).toEqual(second);
  });

  it("D0: a block without an id stays exactly as before", () => {
    const s = run([{ type: "user", text: "go", at: "t" }, { type: "block", name: "card", data: { t: 1 } }, { type: "done", ok: true }]);
    expect(s.entries[1].blocks).toEqual([{ name: "card", data: { t: 1 } }]);
  });
});

describe("reduceChat: a mode switch's line (task-modes spec §5.4)", () => {
  it("keeps the mode on the user entry; D0: no mode, no field", () => {
    const s = reduceChat(initialChat([]), { type: "user", text: "Switched to Socratic", at: "t", mode: "socratic" });
    expect(s.entries[0]).toMatchObject({ role: "user", text: "Switched to Socratic", mode: "socratic" });
    expect(reduceChat(initialChat([]), { type: "user", text: "Hi", at: "t" }).entries[0]).not.toHaveProperty("mode");
  });

  it("resume: a live turn without a new user entry (parallel spec Decision 6)", () => {
    const loaded = run([{ type: "loaded", entries: [{ id: "u", role: "user", text: "hi", blocks: [], activities: [], at: "2026-10-28T10:00:00Z" }] }]);
    const s = reduceChat(loaded, { type: "resume", at: "2026-10-28T10:00:00Z" });
    expect(s.live).not.toBeNull();
    expect(s.entries).toEqual(loaded.entries);
    const t = run([{ type: "text", delta: "hi" }, { type: "paragraph" }, { type: "text", delta: "there" }], s);
    expect(t.live?.text).toBe("hi\n\nthere");
    const done = reduceChat(t, { type: "done", ok: true });
    expect(done.live).toBeNull();
    expect(done.entries.map((e) => [e.role, e.text])).toEqual([
      ["user", "hi"],
      ["assistant", "hi\n\nthere"],
    ]);
  });
});
