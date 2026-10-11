import { describe, expect, it } from "vitest";
import type { ChatEntry } from "../src/client";
import { HEAVY_DEFAULT, compactTokens, formatReset, lastTurnTokens, percent, preflight, resetWindow } from "../src/usage";

const w = (kind: string, utilization: number, resetsAt = "2026-10-11T15:00:00.000Z") => ({ kind, utilization, resetsAt });

describe("preflight", () => {
  it("only asks before heavy actions", () => {
    expect(preflight("medium", [w("five_hour", 0.9)], 0.2)).toBeNull();
    expect(preflight(undefined, [w("five_hour", 0.9)], 0.2)).toBeNull();
  });

  it("stays quiet when the engine reports no five-hour window", () => {
    expect(preflight("heavy", null, 0.5)).toBeNull();
    expect(preflight("heavy", [w("seven_day", 0.99)], 0.5)).toBeNull();
  });

  it("asks when the action would likely take the window to 80 % or more", () => {
    expect(preflight("heavy", [w("five_hour", 0.75)], 0.08)).toEqual({ estimate: 0.08, left: 0.25 });
    expect(preflight("heavy", [w("five_hour", 0.6)], 0.08)).toBeNull();
  });

  it("assumes a default share before the log has a measurement", () => {
    expect(preflight("heavy", [w("five_hour", 0.75)], undefined)).toEqual({ estimate: null, left: 0.25 });
    expect(preflight("heavy", [w("five_hour", 0.8 - HEAVY_DEFAULT - 0.05)], undefined)).toBeNull();
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
    expect(resetWindow([w("five_hour", 1), w("seven_day", 1, "2026-10-14T15:00:00.000Z")])?.kind).toBe("seven_day");
    expect(resetWindow([w("five_hour", 1), w("seven_day", 0.4)])?.kind).toBe("five_hour");
    expect(resetWindow(null)).toBeUndefined();
  });
});
