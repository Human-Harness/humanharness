import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../src/client";
import {
  HEAVY_DEFAULT,
  compactTokens,
  compareTokens,
  currentWindows,
  fiveHour,
  formatReset,
  lastTurnTokens,
  percent,
  preflight,
  resetWindow,
  timesFit,
  timesLeft,
} from "../src/usage";

const w = (kind: string, utilization: number, resetsAt = "2026-10-11T15:00:00.000Z") => ({ kind, utilization, resetsAt });

/** Before the windows built by `w` reset. */
const NOW = Date.parse("2026-10-11T12:00:00.000Z");

describe("preflight", () => {
  it("only asks before heavy actions", () => {
    expect(preflight("medium", [w("five_hour", 0.9)], 0.2, NOW)).toBeNull();
    expect(preflight(undefined, [w("five_hour", 0.9)], 0.2, NOW)).toBeNull();
  });

  it("stays quiet when the engine reports no five-hour window", () => {
    expect(preflight("heavy", null, 0.5, NOW)).toBeNull();
    expect(preflight("heavy", [w("seven_day", 0.99)], 0.5, NOW)).toBeNull();
  });

  it("asks when the action would likely take the window to 80 % or more", () => {
    expect(preflight("heavy", [w("five_hour", 0.75)], 0.08, NOW)).toEqual({ estimate: 0.08, left: 0.25 });
    expect(preflight("heavy", [w("five_hour", 0.6)], 0.08, NOW)).toBeNull();
  });

  it("assumes a default share before the log has a measurement", () => {
    expect(preflight("heavy", [w("five_hour", 0.75)], undefined, NOW)).toEqual({ estimate: null, left: 0.25 });
    expect(preflight("heavy", [w("five_hour", 0.8 - HEAVY_DEFAULT - 0.05)], undefined, NOW)).toBeNull();
  });

  it("ignores a window that has already reset", () => {
    const after = Date.parse("2026-10-11T15:00:00.000Z");
    expect(preflight("heavy", [w("five_hour", 0.95)], 0.08, after)).toBeNull();
  });
});

describe("current windows", () => {
  it("drops windows whose reset time has passed", () => {
    const limits = [w("five_hour", 0.95), w("seven_day", 0.4, "2026-10-14T15:00:00.000Z")];
    expect(currentWindows(limits, NOW)).toEqual(limits);
    expect(currentWindows(limits, Date.parse("2026-10-11T15:00:00.000Z"))).toEqual([limits[1]]);
    expect(currentWindows(null, NOW)).toBeNull();
    expect(fiveHour(limits, Date.parse("2026-10-12T00:00:00.000Z"))).toBeUndefined();
    expect(fiveHour(limits, NOW)?.utilization).toBe(0.95);
  });
});

describe("formatting", () => {
  it("rounds and clamps percentages", () => {
    expect(percent(0.156)).toBe(16);
    expect(percent(1.2)).toBe(100);
    expect(percent(-1)).toBe(0);
  });

  it("shows only the time for a reset within the day, and the weekday otherwise", () => {
    const now = new Date("2026-10-11T12:00:00.000Z");
    const soon = "2026-10-11T15:00:00.000Z";
    const later = "2026-10-14T15:00:00.000Z";
    expect(formatReset(soon, "en", now)).toBe(new Date(soon).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" }));
    expect(formatReset(later, "en", now)).toBe(new Date(later).toLocaleString("en", { weekday: "short", hour: "2-digit", minute: "2-digit" }));
  });

  it("totals the last reply's tokens", () => {
    const base = { blocks: [], activities: [], at: "t" };
    const entries: ChatEntry[] = [
      { ...base, id: "1", role: "assistant", text: "", usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 1, cacheWriteTokens: 1 } },
      { ...base, id: "2", role: "assistant", text: "", usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 100, cacheWriteTokens: 0 } },
      { ...base, id: "3", role: "user", text: "next" },
    ];
    expect(lastTurnTokens(entries)).toBe(1300);
    expect(lastTurnTokens([])).toBeNull();
  });

  it("writes token counts compactly", () => {
    expect(compactTokens(85400, "en")).toBe("85.4K");
  });

  it("mentions the fullest window, the one that frees up last, when out of quota", () => {
    expect(resetWindow([w("five_hour", 1), w("seven_day", 1, "2026-10-14T15:00:00.000Z")], NOW)?.kind).toBe("seven_day");
    expect(resetWindow([w("five_hour", 1), w("seven_day", 0.4)], NOW)?.kind).toBe("five_hour");
    expect(resetWindow(null, NOW)).toBeUndefined();
    // A window that has already reset says nothing about when the limit frees up.
    const later = Date.parse("2026-10-12T00:00:00.000Z");
    expect(resetWindow([w("five_hour", 1), w("seven_day", 0.4, "2026-10-14T15:00:00.000Z")], later)?.kind).toBe("seven_day");
    expect(resetWindow([w("five_hour", 1)], later)).toBeUndefined();
  });
});

describe("Settings › Uso number rules", () => {
  it("rounds how many times a topic fits in a whole window, and says more than 50 past that", () => {
    expect(timesFit(0.08)).toBe(13);
    expect(timesFit(0.9)).toBe(1);
    expect(timesFit(0.02)).toBe(50);
    expect(timesFit(0.019)).toBeNull();
    expect(timesFit(0)).toBeNull();
  });

  it("floors how many more times fit in what is left", () => {
    expect(timesLeft(0.15, 0.05)).toBe(3);
    expect(timesLeft(0.3, 0.1)).toBe(3);
    expect(timesLeft(0.15, 0.08)).toBe(1);
    expect(timesLeft(0.05, 0.08)).toBe(0);
    expect(timesLeft(0.15, 0.002)).toBeNull();
  });

  it("compares a topic's tokens with the average", () => {
    expect(compareTokens(600, 1000)).toEqual({ kind: "half" });
    expect(compareTokens(100, 1000)).toEqual({ kind: "half" });
    expect(compareTokens(700, 1000)).toEqual({ kind: "less" });
    expect(compareTokens(750, 1000)).toEqual({ kind: "average" });
    expect(compareTokens(1330, 1000)).toEqual({ kind: "average" });
    expect(compareTokens(1335, 1000)).toEqual({ kind: "more" });
    expect(compareTokens(1340, 1000)).toEqual({ kind: "times", times: 1.34 });
  });
});
