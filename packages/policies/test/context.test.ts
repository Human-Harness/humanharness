import { describe, expect, it } from "vitest";
import { APP_INDEX_TOKENS, CHECKPOINT_AT, DefaultContextPolicy } from "../src";

describe("DefaultContextPolicy", () => {
  it("is the default policy", () => expect(DefaultContextPolicy.id).toBe("default"));

  it("keeps today's constants", () => {
    expect(CHECKPOINT_AT).toBe(0.8);
    expect(APP_INDEX_TOKENS).toBe(500);
  });

  it("starts a session with today's parts, in today's order, the material's budget passed through", () => {
    const plan = DefaultContextPolicy.start({ scoped: false, materialIndexTokens: 600 });
    expect(plan.parts.map((p) => p.part)).toEqual(["instructions", "notes", "app-notes", "data", "prepared", "pins", "material", "linked"]);
    expect(plan.parts.find((p) => p.part === "app-notes")?.budgetTokens).toBe(500);
    expect(plan.parts.find((p) => p.part === "material")?.budgetTokens).toBe(600);
  });

  it("checkpoints at 80% of the cap, once", () => {
    expect(DefaultContextPolicy.beforeFollowUp({ used: 79, cap: 100, checkpointed: false })).toBe("go");
    expect(DefaultContextPolicy.beforeFollowUp({ used: 80, cap: 100, checkpointed: false })).toBe("checkpoint");
    expect(DefaultContextPolicy.beforeFollowUp({ used: 80, cap: 100, checkpointed: true })).toBe("go");
    expect(DefaultContextPolicy.beforeFollowUp({ used: 1_000, cap: 100, checkpointed: true })).toBe("go");
  });

  it("goes on without a cap or a context, as needsCheckpoint does", () => {
    expect(DefaultContextPolicy.beforeFollowUp({ used: 90, checkpointed: false })).toBe("go");
    expect(DefaultContextPolicy.beforeFollowUp({ cap: 100, checkpointed: false })).toBe("go");
  });

  it("continues every event in a new session from the notes", () => {
    for (const event of ["task-end", "move", "resume"] as const) expect(DefaultContextPolicy.continuity(event)).toBe("new-session-from-notes");
  });
});
