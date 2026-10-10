import { describe, expect, it } from "vitest";
import { type ChatState, initialChat, reduceChat } from "../src/state";

const run = (events: Parameters<typeof reduceChat>[1][], from: ChatState = initialChat([])) => events.reduce(reduceChat, from);

describe("reduceChat", () => {
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

  it("remembers the latest plan limits", () => {
    const windows = [{ kind: "five_hour", utilization: 0.2, resetsAt: "2026-10-10T18:00:00.000Z" }];
    const s = run([{ type: "limits", status: "allowed", windows }]);
    expect(s.limits).toEqual(windows);
  });
});
