import { describe, expect, it } from "vitest";
import { RESERVED_COLLECTIONS, SIDEKICK_MIN_WORDS, defineHarness, sidekickMinWords, sidekickMode, sidekickTips } from "../src";

const minimal = {
  id: "notes",
  name: "Notes",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Notes" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none" as const, exec: false, web: false },
  blocks: {},
  author: "Me",
};
const action = { label: "Draft", prompt: "./agent/tasks/draft.md", cost: "light" as const };

describe("manifest sidekick", () => {
  it("D0: a manifest without sidekick parses as before (no sidekick key)", () => {
    const h = defineHarness({ ...minimal });
    expect(Object.hasOwn(h, "sidekick")).toBe(false);
    expect(sidekickMode(h.sidekick, "anything")).toBe("auto");
    expect(sidekickTips(h.sidekick)).toBeUndefined();
    expect(sidekickMinWords(h.sidekick)).toBe(SIDEKICK_MIN_WORDS);
  });

  it("parses default, tips, actions and checks", () => {
    const h = defineHarness({
      ...minimal,
      actions: { draft: action, export: action },
      sidekick: { default: "on", tips: "Claims need a source.", actions: { draft: "always", export: "off" }, checks: { minWords: 4 } },
    });
    expect(h.sidekick?.default).toBe("on");
    expect(sidekickMode(h.sidekick, "draft")).toBe("always");
    expect(sidekickMode(h.sidekick, "export")).toBe("off");
    expect(sidekickMode(h.sidekick, undefined)).toBe("auto");
    expect(sidekickTips(h.sidekick)).toBe("Claims need a source.");
    expect(sidekickMinWords(h.sidekick)).toBe(4);
  });

  it("default is off when omitted", () => {
    expect(defineHarness({ ...minimal, sidekick: {} }).sidekick?.default).toBe("off");
  });

  it("per-purpose tips: prompt-coach's for the prompt coach", () => {
    const h = defineHarness({ ...minimal, sidekick: { tips: { "prompt-coach": "Short prompts.", mentor: "Be kind." } } });
    expect(sidekickTips(h.sidekick)).toBe("Short prompts.");
    expect(sidekickTips(h.sidekick, "mentor")).toBe("Be kind.");
  });

  it("refuses an unknown action, an unknown check and an unknown purpose", () => {
    expect(() => defineHarness({ ...minimal, sidekick: { actions: { nope: "auto" } } })).toThrow(/nope/);
    expect(() => defineHarness({ ...minimal, sidekick: { checks: { maxWords: 3 } } as never })).toThrow();
    expect(() => defineHarness({ ...minimal, sidekick: { tips: { wizard: "x" } } as never })).toThrow();
  });

  it("reserves the action id and the collection", () => {
    expect(() => defineHarness({ ...minimal, actions: { sidekick: action } })).toThrow(/reserved/);
    expect(RESERVED_COLLECTIONS).toContain("sidekick");
  });
});
