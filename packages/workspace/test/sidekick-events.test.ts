import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SIDEKICK_EVENTS_MAX, type SidekickEvent, appendSidekickEvent, readSidekickEvents, sidekickEventsFile, thresholdFor, usedShare, whyShown } from "../src/sidekick-events";

const ev = (o: Partial<SidekickEvent>): SidekickEvent => ({ at: "2026-10-27T10:00:00Z", sidekick: "sidekick", moment: "pre", kind: "vague", outcome: "used", ...o });

describe("events.jsonl (spec §6.1)", () => {
  it("lives in .harness/sidekick/ and appends lines", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "hh-ske-"));
    expect(sidekickEventsFile(base)).toBe(path.join(base, ".harness", "sidekick", "events.jsonl"));
    await appendSidekickEvent(base, ev({}));
    await appendSidekickEvent(base, ev({ outcome: "dismissed" }));
    expect((await readSidekickEvents(base)).map((e) => e.outcome)).toEqual(["used", "dismissed"]);
  });

  it("keeps the last 2,000 lines; skips broken ones", async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), "hh-ske-"));
    const file = sidekickEventsFile(base);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Array.from({ length: SIDEKICK_EVENTS_MAX + 250 }, (_, i) => JSON.stringify(ev({ task: `t${i}` }))).join("\n") + "\n{broken\n");
    await appendSidekickEvent(base, ev({ task: "last" }));
    const all = await readSidekickEvents(base);
    expect(all).toHaveLength(SIDEKICK_EVENTS_MAX);
    expect(all.at(-1)?.task).toBe("last");
  });
});

describe("thresholds per sidekick and kind (spec §6.2, D12)", () => {
  it("0.5 until 10 cards; 0.8 when under 20% of the last 10 were used", () => {
    const nine = Array.from({ length: 9 }, () => ev({ outcome: "dismissed" }));
    expect(thresholdFor(nine, "sidekick", "vague")).toBe(0.5);
    const ten = [...nine, ev({ outcome: "used" })];
    expect(thresholdFor(ten, "sidekick", "vague")).toBe(0.8);
    expect(thresholdFor([...ten, ev({ outcome: "used" })], "sidekick", "vague")).toBe(0.5);
  });

  it("per sidekick: ignoring the mentor never quiets the prompt coach; timeouts don't count", () => {
    const mentor = Array.from({ length: 10 }, () => ev({ sidekick: "mentor", outcome: "dismissed" }));
    expect(thresholdFor(mentor, "mentor", "vague")).toBe(0.8);
    expect(thresholdFor(mentor, "sidekick", "vague")).toBe(0.5);
    expect(thresholdFor(Array.from({ length: 10 }, () => ev({ outcome: "timeout" })), "sidekick", "vague")).toBe(0.5);
  });

  it("used share and why shown", () => {
    const e = [ev({ outcome: "used" }), ev({ outcome: "edited" }), ev({ outcome: "dismissed" }), ev({ kind: "two-asks" })];
    expect(usedShare(e)).toEqual({ used: 3, of: 4 });
    expect(whyShown(e, "sidekick", "vague")).toEqual({ kind: "vague", used: 2, of: 3 });
    expect(whyShown(e, "sidekick", "two-asks")).toBeNull();
  });
});
