import { describe, expect, it } from "vitest";
import { type Paused, NO_PAUSED, countPaused, pausedSummary } from "../src/focus-notices";

const t = (k: string, o?: Record<string, unknown>) =>
  ({
    "focus.summary": `While you were reading: ${o?.items}.`,
    "focus.waiting": "the task is waiting for you",
    "focus.quota": "your plan's limit ran out",
    "focus.proposal": o?.count === 1 ? "the AI proposed to move to another part" : `the AI proposed to move to another part ${o?.count} times`,
  })[k] ?? k;

describe("paused notices (§6.2)", () => {
  it("count what happened and say it in one line", () => {
    let p: Paused = NO_PAUSED;
    p = countPaused(p, { waiting: true });
    p = countPaused(p, { proposal: true });
    p = countPaused(p, { proposal: true });
    expect(pausedSummary(t, p)).toBe("While you were reading: the task is waiting for you, the AI proposed to move to another part 2 times.");
  });

  it("nothing happened: no line", () => {
    expect(pausedSummary(t, NO_PAUSED)).toBeNull();
  });
});
