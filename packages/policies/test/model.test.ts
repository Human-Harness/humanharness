import { describe, expect, it } from "vitest";
import { DefaultModelPolicy } from "../src";

describe("DefaultModelPolicy", () => {
  it("is the default policy", () => expect(DefaultModelPolicy.id).toBe("default"));

  it("picks the task's profile: the manifest's tier through the core's table", () => {
    expect(DefaultModelPolicy.pick({ engine: "claude", action: "turn", manifestTier: "deep", models: {} })).toEqual({ engine: "claude", tier: "deep", model: "opus", effort: "high", cap: 400_000, subagentModel: "sonnet" });
  });

  it("a fixed tier skips the person's choice for the task", () => {
    const models = { tasks: { sidekick: "deep" as const } };
    expect(DefaultModelPolicy.pick({ engine: "claude", action: "sidekick", tier: "light", models })).toMatchObject({ tier: "light", model: "haiku" });
  });

  it("with an offer: falls back to a listed model, then fits the effort up and down", () => {
    const models = { tiers: { codex: { standard: { model: "gpt-9", effort: "max" as const, cap: 200_000 } } } };
    // Raised: light's "low" is not offered and nothing is below it, so the lowest offered.
    expect(DefaultModelPolicy.pick({ engine: "codex", models, offer: { models: [{ id: "gpt-5.5" }], efforts: ["medium", "high"] } })).toEqual({ engine: "codex", tier: "light", effort: "medium", cap: 100_000, fallbackFrom: "gpt-9" });
    // Lowered: the listed model stays, "max" is not offered, so the closest offered below it.
    expect(DefaultModelPolicy.pick({ engine: "codex", models, offer: { models: [{ id: "gpt-9" }], efforts: ["low", "medium", "high"] } })).toEqual({ engine: "codex", tier: "standard", model: "gpt-9", effort: "high", cap: 200_000 });
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

describe("subagent model (subagent policy D2)", () => {
  const sub = (tier: "light" | "standard" | "deep", models = {}) => DefaultModelPolicy.subagentModel(DefaultModelPolicy.pick({ engine: "claude", tier, models }), models);

  it("is one tier below the task's: deep → sonnet, standard → haiku, light → haiku", () => {
    expect(sub("deep")).toBe("sonnet");
    expect(sub("standard")).toBe("haiku");
    expect(sub("light")).toBe("haiku");
  });

  it("follows the person's table", () => {
    const models = { tiers: { claude: { standard: { model: "sonnet-x", effort: "medium" as const, cap: 200_000 } } } };
    expect(sub("deep", models)).toBe("sonnet-x");
  });

  it("a custom profile counts as light's model; an engine whose table names no model gives none", () => {
    const custom = { engine: "claude", tier: "custom" as const, model: "opus", effort: "high" as const, cap: 400_000 };
    expect(DefaultModelPolicy.subagentModel(custom, {})).toBe("haiku");
    expect(DefaultModelPolicy.subagentModel(DefaultModelPolicy.pick({ engine: "codex", tier: "deep", models: {} }), {})).toBeUndefined();
  });

  it("pick and fallback record it on the profile; an engine without one has no key", () => {
    const deep = DefaultModelPolicy.pick({ engine: "claude", tier: "deep", models: {} });
    expect(deep.subagentModel).toBe("sonnet");
    expect(DefaultModelPolicy.fallback(deep, {}, [])).toMatchObject({ tier: "standard", subagentModel: "haiku" });
    expect("subagentModel" in DefaultModelPolicy.pick({ engine: "codex", tier: "deep", models: {} })).toBe(false);
  });
});
