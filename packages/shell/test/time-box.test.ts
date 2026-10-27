import { describe, expect, it } from "vitest";
import { formatTimeLeft, nextDue, paused, remainingMs, running, usedMs } from "../src/main/time-box";

const t0 = new Date("2026-10-26T10:00:00.000Z");
const later = (ms: number) => new Date(t0.getTime() + ms);
const MIN = 60_000;

describe("time box arithmetic (task-phases spec §5)", () => {
  it("counts used time while running, and folds it when paused", () => {
    const box = { minutes: 10, usedMs: 2 * MIN, runningSince: t0.toISOString() };
    expect(usedMs(box, later(MIN))).toBe(3 * MIN);
    expect(remainingMs(box, later(MIN))).toBe(7 * MIN);
    const p = paused(box, later(MIN));
    expect(p).toEqual({ minutes: 10, usedMs: 3 * MIN });
    expect(usedMs(p, later(5 * MIN))).toBe(3 * MIN);
    expect(running(p, later(5 * MIN))).toEqual({ minutes: 10, usedMs: 3 * MIN, runningSince: later(5 * MIN).toISOString() });
    expect(remainingMs({ minutes: 1, usedMs: 5 * MIN }, t0)).toBe(0);
  });

  it("the next step: the wrap-up at its share, then the end; nothing once both ran", () => {
    const box = { minutes: 20, usedMs: 0, runningSince: t0.toISOString() };
    expect(nextDue(box, 0.85, t0)).toEqual({ kind: "wrap-up", inMs: 17 * MIN });
    expect(nextDue(box, undefined, t0)).toEqual({ kind: "wrap-up", inMs: 20 * MIN });
    expect(nextDue({ ...box, wrappedUp: true }, 0.85, later(18 * MIN))).toEqual({ kind: "end", inMs: 2 * MIN });
    expect(nextDue({ ...box, wrappedUp: true, ended: true }, 0.85, t0)).toBeNull();
    expect(nextDue(box, 0.5, later(30 * MIN))).toEqual({ kind: "wrap-up", inMs: 0 });
    // A short minute (tests, mock mode).
    expect(nextDue(box, 0.5, t0, 1000)).toEqual({ kind: "wrap-up", inMs: 10_000 });
  });

  it("says the time left in words", () => {
    expect(formatTimeLeft(12 * MIN)).toBe("about 12 minutes");
    expect(formatTimeLeft(30_000)).toBe("about 1 minute");
    expect(formatTimeLeft(0)).toBe("none");
  });
});
