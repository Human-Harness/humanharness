import { describe, expect, it } from "vitest";
import { CAP_OPTIONS, CLAUDE_MODELS, DEFAULT_TIERS, defaultTier, getEngine, isCap, isEffort, isModelId } from "../src";

describe("DEFAULT_TIERS", () => {
  it("matches the spec's tables (§5.1): Claude by alias, Codex on its default model", () => {
    expect(DEFAULT_TIERS.claude).toEqual({
      light: { model: "haiku", effort: "low", cap: 100_000 },
      standard: { model: "sonnet", effort: "medium", cap: 200_000 },
      deep: { model: "opus", effort: "high", cap: 400_000 },
    });
    expect(DEFAULT_TIERS.codex).toEqual({
      light: { effort: "low", cap: 100_000 },
      standard: { effort: "medium", cap: 200_000 },
      deep: { effort: "high", cap: 400_000 },
    });
  });

  it("runs an engine without a table on its default model", () => {
    expect(defaultTier("kimi", "deep")).toEqual({ effort: "high", cap: 400_000 });
    expect(defaultTier("claude", "light")).toEqual({ model: "haiku", effort: "low", cap: 100_000 });
  });

  it("offers the caps 100k to 1M and Claude's three aliases", () => {
    expect(CAP_OPTIONS).toEqual([100_000, 200_000, 400_000, 1_000_000]);
    expect(CLAUDE_MODELS).toEqual(["haiku", "sonnet", "opus"]);
    expect(getEngine("claude").models).toEqual({ list: ["haiku", "sonnet", "opus"], efforts: ["low", "medium", "high", "xhigh", "max"] });
    expect(getEngine("codex").models).toEqual({ efforts: ["low", "medium", "high"] });
  });
});

describe("value checks", () => {
  it("accepts model ids that are safe on a command line, never a flag", () => {
    for (const id of ["opus", "gpt-5.5", "claude-opus-4-1[1m]", "o3_mini"]) expect(isModelId(id)).toBe(true);
    for (const id of ["-rf", "--model", "a b", "", "x".repeat(65), "a;b", "a/b", 7]) expect(isModelId(id)).toBe(false);
  });

  it("accepts the known efforts and integer caps from 100k to 1M", () => {
    expect(["low", "medium", "high", "xhigh", "max"].every(isEffort)).toBe(true);
    expect(isEffort("turbo")).toBe(false);
    expect([100_000, 400_000, 1_000_000].every(isCap)).toBe(true);
    for (const cap of [99_999, 1_000_001, 150_000.5, "200000"]) expect(isCap(cap)).toBe(false);
  });
});
