import { describe, expect, it } from "vitest";
import { compareTokens, timesFit, timesLeft } from "../src/times";

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
