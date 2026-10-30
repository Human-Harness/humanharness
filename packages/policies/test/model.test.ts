import { describe, expect, it } from "vitest";
import { DefaultModelPolicy } from "../src";

describe("DefaultModelPolicy", () => {
  it("is the default policy", () => expect(DefaultModelPolicy.id).toBe("default"));

  it("picks the task's profile: the manifest's tier through the core's table", () => {
    expect(DefaultModelPolicy.pick({ engine: "claude", action: "turn", manifestTier: "deep", models: {} })).toEqual({ engine: "claude", tier: "deep", model: "opus", effort: "high", cap: 400_000 });
  });

  it("a fixed tier skips the person's choice for the task", () => {
    const models = { tasks: { sidekick: "deep" as const } };
    expect(DefaultModelPolicy.pick({ engine: "claude", action: "sidekick", tier: "light", models })).toMatchObject({ tier: "light", model: "haiku" });
  });

  it("with an offer: falls back to a listed model, then fits the effort", () => {
    const p = DefaultModelPolicy.pick({ engine: "codex", models: { tiers: { codex: { standard: { model: "gpt-9", effort: "max", cap: 200_000 } } } }, offer: { models: [{ id: "gpt-5.5" }], efforts: ["low", "medium", "high"] } });
    expect(p).toEqual({ engine: "codex", tier: "light", effort: "low", cap: 100_000, fallbackFrom: "gpt-9" });
  });

  it("falls back deep → standard → light → the engine's default, then null", () => {
    const deep = DefaultModelPolicy.pick({ engine: "claude", manifestTier: "deep", models: {} });
    const standard = DefaultModelPolicy.fallback(deep, {}, []);
    expect(standard).toMatchObject({ tier: "standard", model: "sonnet", fallbackFrom: "opus" });
    const light = DefaultModelPolicy.fallback(standard!, {}, ["opus"]);
    const last = DefaultModelPolicy.fallback(light!, {}, ["opus", "sonnet"]);
    expect(last?.model).toBeUndefined();
    expect(DefaultModelPolicy.fallback(last!, {}, ["opus", "sonnet", "haiku"])).toBeNull();
  });
});
