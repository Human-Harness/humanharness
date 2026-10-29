import type { Event } from "@humanharness/runtime";
import { describe, expect, it } from "vitest";
import { LiveBuffer, laneEmit } from "../src/main/live-buffer";

const act = (id: string, extra: Partial<Extract<Event, { type: "activity" }>> = {}): Event => ({
  type: "activity",
  id,
  kind: "edit",
  detail: id,
  state: "start",
  ...extra,
});

describe("LiveBuffer (Decision 6)", () => {
  it("keeps a lane's events from its last user line until done; a new user line starts over", () => {
    const b = new LiveBuffer(5);
    b.user("t1", { text: "hi", at: "2026-10-28T10:00:00Z" });
    b.event("t1", { type: "text", delta: "a" });
    expect(b.live("t1")).toEqual({ user: { text: "hi", at: "2026-10-28T10:00:00Z" }, events: [{ type: "text", delta: "a" }] });
    b.user("t1", { text: "again", at: "2026-10-28T10:01:00Z" });
    expect(b.live("t1")).toEqual({ user: { text: "again", at: "2026-10-28T10:01:00Z" }, events: [] });
    b.event("t1", { type: "done", ok: true });
    expect(b.live("t1")).toBeUndefined();
    expect(b.live("nobody")).toBeUndefined();
  });

  it("ignores events of a lane with no user line (a quiet turn), and drop() forgets a lane", () => {
    const b = new LiveBuffer();
    b.event("t1", { type: "text", delta: "x" });
    expect(b.live("t1")).toBeUndefined();
    b.user("t1", { text: "x", at: "t" });
    b.drop("t1");
    expect(b.live("t1")).toBeUndefined();
  });

  it("keeps at most `max` events, oldest dropped", () => {
    const b = new LiveBuffer(2);
    b.user("t1", { text: "x", at: "t" });
    for (const id of ["1", "2", "3"]) b.event("t1", act(id));
    expect(b.live("t1")?.events.map((e) => (e as { id: string }).id)).toEqual(["2", "3"]);
  });

  it("keeps consecutive text deltas as one event, so a long answer never fills the buffer", () => {
    const b = new LiveBuffer(3);
    b.user("t1", { text: "x", at: "t" });
    for (let i = 0; i < 5000; i++) b.event("t1", { type: "text", delta: "a" });
    b.event("t1", { type: "paragraph" });
    b.event("t1", { type: "text", delta: "b" });
    const events = b.live("t1")?.events ?? [];
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: "text", delta: "a".repeat(5000) });
    expect(events.slice(1)).toEqual([{ type: "paragraph" }, { type: "text", delta: "b" }]);
  });

  it("keeps about `maxChars` characters: the oldest events go, and one long text keeps its end", () => {
    const b = new LiveBuffer(100, 10);
    b.user("t1", { text: "x", at: "t" });
    b.event("t1", { type: "text", delta: "12345" });
    b.event("t1", act("a"));
    b.event("t1", { type: "text", delta: "abcdefgh" });
    expect(b.live("t1")?.events).toEqual([{ type: "text", delta: "abcdefgh" }]);
    b.event("t1", { type: "text", delta: "XYZ" });
    // Over the budget, the run keeps about ¾ of it (7 of 10).
    expect(b.live("t1")?.events).toEqual([{ type: "text", delta: "efghXYZ" }]);
  });

  it("a trim never leaves half a surrogate pair", () => {
    const b = new LiveBuffer(100, 10);
    b.user("t1", { text: "x", at: "t" });
    // "😀" is two UTF-16 units: 12 units, trimmed to ¾ of 10 = the last 7, cuts the first emoji in half.
    b.event("t1", { type: "text", delta: "abcd😀😀😀😀" });
    const delta = (b.live("t1")?.events[0] as { delta: string }).delta;
    expect(delta).toBe("😀😀😀");
    const first = delta.charCodeAt(0);
    expect(first >= 0xdc00 && first <= 0xdfff).toBe(false);
  });

  it("past the budget, a long run of deltas trims it rarely, not on every delta", () => {
    const b = new LiveBuffer(100, 100);
    b.user("t1", { text: "x", at: "t" });
    let trims = 0;
    let before = 0;
    for (let i = 0; i < 1000; i++) {
      b.event("t1", { type: "text", delta: "a" });
      const length = (b.live("t1")?.events[0] as { delta: string }).delta.length;
      if (length < before) trims++;
      expect(length).toBeLessThanOrEqual(100);
      before = length;
    }
    // Each trim leaves 75 of 100: the next comes 26 deltas later.
    expect(trims).toBeGreaterThan(0);
    expect(trims).toBeLessThanOrEqual(Math.ceil(1000 / 26));
  });

  it("never keeps an activity's edits (paths stay in main)", () => {
    const b = new LiveBuffer();
    b.user("t1", { text: "x", at: "t" });
    b.event("t1", act("a", { edits: ["/Users/me/folder/secret.md"] }));
    expect(b.live("t1")?.events[0]).not.toHaveProperty("edits");
    expect(JSON.stringify(b.live("t1"))).not.toContain("secret.md");
  });

  it("live() hands out a copy", () => {
    const b = new LiveBuffer();
    b.user("t1", { text: "x", at: "t" });
    b.live("t1")?.events.push({ type: "paragraph" });
    expect(b.live("t1")?.events).toEqual([]);
  });
});

describe("laneEmit: only the focused lane talks to the window (Decision 6)", () => {
  it("a background lane only buffers; focusing it replays its turn and nothing from the old lane", () => {
    const b = new LiveBuffer();
    let focused = "t1";
    const window: Event[] = [];
    const deps = { isFocused: (id: string) => id === focused, toWindow: (e: Event) => void window.push(e) };
    const one = laneEmit("t1", b, deps);
    const two = laneEmit("t2", b, deps);
    b.user("t1", { text: "one", at: "a" });
    b.user("t2", { text: "two", at: "b" });
    one({ type: "text", delta: "from one" });
    two({ type: "text", delta: "from two" });
    expect(window).toEqual([{ type: "text", delta: "from one" }]);
    focused = "t2";
    expect(b.live(focused)).toEqual({ user: { text: "two", at: "b" }, events: [{ type: "text", delta: "from two" }] });
    one({ type: "text", delta: " more" });
    two({ type: "paragraph" });
    expect(window).toEqual([{ type: "text", delta: "from one" }, { type: "paragraph" }]);
  });

  it("strips edits on the way to the window", () => {
    const b = new LiveBuffer();
    const window: Event[] = [];
    const emit = laneEmit("t1", b, { isFocused: () => true, toWindow: (e) => void window.push(e) });
    emit(act("a", { edits: ["/abs/path.md"] }));
    expect(window).toEqual([act("a")]);
  });
});
