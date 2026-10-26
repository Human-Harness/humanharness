import { describe, expect, it } from "vitest";
import { type Effort, getEngine } from "@humanharness/engines";
import { cleanModels, cleanProfile, engineOffer, firstOffered, fitEffort, nearestTier, nextFallback, resolveProfile, taskKey } from "../src/main/models";

describe("cleanModels", () => {
  it("keeps valid task choices and tier overrides, field by field", () => {
    const raw = {
      tasks: { manifest: "deep", questions: "light", turn: { custom: { engine: "claude", model: "opus", effort: "high", cap: 400_000 } } },
      tiers: { claude: { deep: { model: "claude-opus-4-1[1m]", effort: "max", cap: 1_000_000 } }, codex: { light: { effort: "low", cap: 100_000 } } },
    };
    expect(cleanModels(raw)).toEqual(raw);
  });

  it("drops bad entries so the defaults apply: flags, spaces, unknown efforts, caps out of range, unknown tiers", () => {
    const raw = {
      tasks: {
        a: "huge",
        b: { custom: { engine: "claude", model: "--dangerously-skip-permissions", effort: "high", cap: 400_000 } },
        c: { custom: { model: "opus", effort: "high", cap: 400_000 } },
        d: { custom: { engine: "claude", model: "opus", effort: "turbo", cap: 400_000 } },
        "Bad Key": "deep",
        e: "standard",
      },
      tiers: {
        claude: { deep: { model: "a b", effort: "high", cap: 400_000 }, light: { effort: "low", cap: 50_000 }, huge: { effort: "low", cap: 100_000 }, standard: { effort: "high", cap: 200_000 } },
        "-x": { light: { effort: "low", cap: 100_000 } },
      },
    };
    expect(cleanModels(raw)).toEqual({ tasks: { e: "standard" }, tiers: { claude: { standard: { effort: "high", cap: 200_000 } } } });
    expect(cleanModels(null)).toEqual({});
    expect(cleanModels({ tasks: [], tiers: "x" })).toEqual({});
  });
});

describe("resolveProfile", () => {
  it("uses the manifest tier, else standard, through the default tables", () => {
    expect(resolveProfile({ engine: "claude", action: "turn", manifestTier: "deep", models: {} })).toEqual({ engine: "claude", tier: "deep", model: "opus", effort: "high", cap: 400_000 });
    expect(resolveProfile({ engine: "claude", action: "turn", models: {} })).toEqual({ engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000 });
    expect(resolveProfile({ engine: "codex", models: {} })).toEqual({ engine: "codex", tier: "standard", effort: "medium", cap: 200_000 });
  });

  it("prefers the user's tier for the task, then the user's table for that tier", () => {
    const models = { tasks: { turn: "light" as const }, tiers: { claude: { light: { model: "sonnet", effort: "low" as const, cap: 100_000 } } } };
    expect(resolveProfile({ engine: "claude", action: "turn", manifestTier: "deep", models })).toEqual({ engine: "claude", tier: "light", model: "sonnet", effort: "low", cap: 100_000 });
  });

  it("uses a custom setting as it is, for its own engine only", () => {
    const models = { tasks: { questions: { custom: { engine: "claude", model: "opus", effort: "max" as const, cap: 1_000_000 } } } };
    expect(resolveProfile({ engine: "claude", models })).toEqual({ engine: "claude", tier: "custom", model: "opus", effort: "max", cap: 1_000_000 });
    expect(resolveProfile({ engine: "codex", manifestTier: "light", models })).toEqual({ engine: "codex", tier: "light", effort: "low", cap: 100_000 });
  });

  it("keys free questions as questions", () => {
    expect(taskKey(undefined)).toBe("questions");
    expect(taskKey("manifest")).toBe("manifest");
  });
});

describe("nextFallback", () => {
  const deep = resolveProfile({ engine: "claude", manifestTier: "deep", models: {} });

  it("walks deep → standard → light → the engine default, remembering the first missing model", () => {
    const standard = nextFallback(deep, {});
    expect(standard).toEqual({ engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000, fallbackFrom: "opus" });
    const light = nextFallback(standard!, {}, ["opus"]);
    expect(light).toEqual({ engine: "claude", tier: "light", model: "haiku", effort: "low", cap: 100_000, fallbackFrom: "opus" });
    const engineDefault = nextFallback(light!, {}, ["opus", "sonnet"]);
    expect(engineDefault).toEqual({ engine: "claude", tier: "light", effort: "low", cap: 100_000, fallbackFrom: "opus" });
    expect(nextFallback(engineDefault!, {}, ["opus", "sonnet", "haiku"])).toBeNull();
  });

  it("skips a lower tier that runs on a model that already failed", () => {
    const models = { tiers: { claude: { standard: { model: "opus", effort: "medium" as const, cap: 200_000 } } } };
    expect(nextFallback(deep, models)).toMatchObject({ tier: "light", model: "haiku" });
  });

  it("sends a custom profile straight to the engine default", () => {
    const custom = { engine: "claude", tier: "custom" as const, model: "opus", effort: "max" as const, cap: 1_000_000 };
    expect(nextFallback(custom, {})).toEqual({ engine: "claude", tier: "custom", effort: "max", cap: 1_000_000, fallbackFrom: "opus" });
  });
});

describe("firstOffered", () => {
  it("keeps a profile when the engine's list is unknown or includes its model", () => {
    const p = { engine: "codex", tier: "deep" as const, model: "gpt-5.5", effort: "high" as const, cap: 400_000 };
    expect(firstOffered(p, {}, undefined)).toBe(p);
    expect(firstOffered(p, {}, [{ id: "gpt-5.5" }])).toBe(p);
  });

  it("falls back before the turn when Codex's saved list lacks the model", () => {
    const p = { engine: "codex", tier: "deep" as const, model: "gpt-9", effort: "high" as const, cap: 400_000 };
    expect(firstOffered(p, {}, [{ id: "gpt-5.5" }])).toEqual({ engine: "codex", tier: "standard", effort: "medium", cap: 200_000, fallbackFrom: "gpt-9" });
  });
});

describe("cleanProfile", () => {
  it("keeps a valid stored profile and refuses one whose model reads as a flag", () => {
    const p = { engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000, fallbackFrom: "opus" };
    expect(cleanProfile(p)).toEqual(p);
    expect(cleanProfile({ ...p, model: "-x" })).toBeNull();
    expect(cleanProfile({ ...p, tier: "huge" })).toBeNull();
    expect(cleanProfile({ ...p, fallbackFrom: "-x" })).toEqual({ engine: "claude", tier: "standard", model: "sonnet", effort: "medium", cap: 200_000 });
  });
});

describe("engineOffer", () => {
  it("offers Claude's aliases and efforts, and Codex's saved list or only its default", () => {
    expect(engineOffer(getEngine("claude"), {})).toEqual({ models: [{ id: "haiku" }, { id: "sonnet" }, { id: "opus" }], efforts: ["low", "medium", "high", "xhigh", "max"] });
    expect(engineOffer(getEngine("codex"), {})).toEqual({ models: [], efforts: ["low", "medium", "high"] });
    expect(engineOffer(getEngine("codex"), { models: [{ id: "gpt-5.5", name: "GPT-5.5" }], efforts: ["low", "xhigh"] })).toEqual({
      models: [{ id: "gpt-5.5", name: "GPT-5.5" }],
      efforts: ["low", "xhigh"],
    });
  });

  it("never offers a saved model or effort that isn't safe", () => {
    const saved = { models: [{ id: "--x" }, { id: "gpt-5.5" }], efforts: ["turbo", "high"] } as never;
    expect(engineOffer(getEngine("codex"), saved)).toEqual({ models: [{ id: "gpt-5.5" }], efforts: ["high"] });
  });
});

describe("fitEffort", () => {
  const p = { engine: "codex", tier: "deep" as const, effort: "max" as const, cap: 400_000 };

  it("keeps an effort the engine offers", () => {
    expect(fitEffort({ ...p, effort: "high" }, ["low", "medium", "high"])).toEqual({ ...p, effort: "high" });
  });

  it("lowers an effort the engine doesn't offer to the closest one below, else the lowest above", () => {
    expect(fitEffort(p, ["low", "medium", "high"])).toEqual({ ...p, effort: "high" });
    expect(fitEffort({ ...p, effort: "xhigh" }, ["low", "max"])).toEqual({ ...p, effort: "low" });
    expect(fitEffort({ ...p, effort: "low" }, ["high", "xhigh"])).toEqual({ ...p, effort: "high" });
  });

  it("leaves the profile alone when the engine offers no effort", () => {
    expect(fitEffort(p, [])).toEqual(p);
  });
});

describe("tiers for modes (task-modes spec §5.3)", () => {
  const custom = (model: string | undefined, effort: Effort) => ({ engine: "claude", tier: "custom" as const, ...(model ? { model } : {}), effort, cap: 200_000 });

  it("a tier profile counts as its tier; a custom one as the tier whose model it runs, else by its effort", () => {
    expect(nearestTier({ engine: "claude", tier: "light", model: "haiku", effort: "low", cap: 100_000 }, {})).toBe("light");
    expect(nearestTier(custom("opus", "low"), {})).toBe("deep");
    expect(nearestTier(custom("sonnet", "high"), {})).toBe("standard");
    // The person's own table counts: their deep tier runs sonnet here.
    expect(nearestTier(custom("sonnet", "high"), { tiers: { claude: { deep: { model: "sonnet", effort: "high", cap: 400_000 } } } })).toBe("deep");
    expect(nearestTier(custom("some-model", "low"), {})).toBe("light");
    expect(nearestTier(custom(undefined, "medium"), {})).toBe("standard");
    expect(nearestTier(custom("some-model", "max"), {})).toBe("deep");
  });

  it("a floor raises a lower tier, never lowers a higher one, and leaves a custom choice alone", () => {
    expect(resolveProfile({ engine: "claude", action: "study", models: {}, floor: "deep" })).toMatchObject({ tier: "deep", model: "opus" });
    expect(resolveProfile({ engine: "claude", action: "study", manifestTier: "deep", models: {}, floor: "standard" })).toMatchObject({ tier: "deep" });
    expect(resolveProfile({ engine: "claude", action: "study", models: { tasks: { study: "light" } }, floor: "standard" })).toMatchObject({ tier: "standard" });
    const own = { tasks: { study: { custom: { engine: "claude", model: "haiku", effort: "low" as const, cap: 100_000 } } } };
    expect(resolveProfile({ engine: "claude", action: "study", models: own, floor: "deep" })).toMatchObject({ tier: "custom", model: "haiku" });
    // No floor: exactly as before.
    expect(resolveProfile({ engine: "claude", action: "study", models: {} })).toMatchObject({ tier: "standard", model: "sonnet" });
  });
});
