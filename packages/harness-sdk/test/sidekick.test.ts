import { describe, expect, it } from "vitest";
import {
  DEFAULT_SIDEKICK,
  RESERVED_COLLECTIONS,
  SIDEKICK_COLLECTION,
  SIDEKICK_MIN_WORDS,
  SIDEKICK_SETTINGS_ID,
  dataCollections,
  defineHarness,
  purposeMoments,
  sidekickCollection,
  sidekickMinWords,
  sidekickMode,
  sidekickSettings,
  sidekickTips,
  speaksAt,
} from "../src";

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

describe("sidekick collection", () => {
  it("is app-wide, keyed by id, hidden from the agent", () => {
    const c = sidekickCollection();
    expect(c.scoped).toBe(false);
    expect(c.key).toBe("id");
    expect(c.agent).toBe("none");
  });

  it("accepts the settings record and refuses unknown values", () => {
    const schema = sidekickCollection().schema;
    expect(schema.safeParse({ id: SIDEKICK_SETTINGS_ID, type: "settings", on: true, wait: 10, cap: "none" }).success).toBe(true);
    expect(schema.safeParse({ id: SIDEKICK_SETTINGS_ID, type: "settings", wait: 7 }).success).toBe(false);
    expect(schema.safeParse({ id: SIDEKICK_SETTINGS_ID, type: "settings", cap: 1 }).success).toBe(false);
    expect(schema.safeParse({ id: "x", type: "settings" }).success).toBe(false);
  });

  it("settings fall back to the manifest default and the core defaults", () => {
    expect(sidekickSettings(null, undefined)).toEqual({ on: false, preSend: true, afterReply: true, headsUps: true, wait: 6, cap: 20_000, introSeen: false, presetsOffered: false, muted: {} });
    expect(sidekickSettings(null, { default: "on" }).on).toBe(true);
    expect(sidekickSettings({ id: "settings", type: "settings", on: false, cap: 50_000 }, { default: "on" })).toEqual({ on: false, preSend: true, afterReply: true, headsUps: true, wait: 6, cap: 50_000, introSeen: false, presetsOffered: false, muted: {} });
  });

  it("D0: dataCollections never includes it", () => {
    const h = defineHarness({ ...minimal });
    expect(dataCollections(h)).toBe(h.data);
    expect(Object.hasOwn(dataCollections(h), SIDEKICK_COLLECTION)).toBe(false);
  });
});

describe("several sidekicks (spec §2a)", () => {
  const schema = () => sidekickCollection().schema;

  it("D0: a block without places and presets parses as before", () => {
    const h = defineHarness({ ...minimal, sidekick: { default: "on" } });
    expect(h.sidekick).toEqual({ default: "on" });
  });

  it("places: action-id pattern, unique", () => {
    expect(defineHarness({ ...minimal, sidekick: { places: [{ id: "terminal", label: "Terminal", description: "Agent output." }] } }).sidekick?.places).toHaveLength(1);
    expect(() => defineHarness({ ...minimal, sidekick: { places: [{ id: "Bad", label: "x", description: "y" }] } })).toThrow();
    expect(() => defineHarness({ ...minimal, sidekick: { places: [{ id: "t", label: "a", description: "b" }, { id: "t", label: "c", description: "d" }] } })).toThrow(/unique/);
  });

  it("presets: known purposes, custom with text and known moments, personality within 1,500", () => {
    const ok = { name: "Guard", mark: "🛡️", personality: "Calm.", purposes: [{ id: "process-guard" as const }, { id: "custom" as const, text: "Watch the terminal.", moments: ["place:terminal"] }] };
    const h = defineHarness({ ...minimal, sidekick: { places: [{ id: "terminal", label: "Terminal", description: "x" }], presets: [ok] } });
    expect(h.sidekick?.presets?.[0].name).toBe("Guard");
    expect(() => defineHarness({ ...minimal, sidekick: { presets: [{ ...ok, purposes: [{ id: "wizard" }] }] } as never })).toThrow();
    expect(() => defineHarness({ ...minimal, sidekick: { presets: [{ ...ok, purposes: [{ id: "custom", text: "x", moments: ["place:nope"] }] }] } })).toThrow(/place/);
    expect(() => defineHarness({ ...minimal, sidekick: { presets: [{ ...ok, personality: "x".repeat(1501) }] } })).toThrow();
  });

  it("purpose moments and speaksAt", () => {
    expect(purposeMoments({ id: "prompt-coach" })).toEqual(["pre-send", "after-reply"]);
    expect(purposeMoments({ id: "custom", text: "x", moments: ["daily"] })).toEqual(["daily"]);
    expect(speaksAt(DEFAULT_SIDEKICK, "pre-send")).toBe(true);
    expect(speaksAt(DEFAULT_SIDEKICK, "heads-up")).toBe(true);
    expect(speaksAt(DEFAULT_SIDEKICK, "daily")).toBe(false);
  });

  it("record types: learned, sidekick and scope, each with its own fields", () => {
    expect(schema().safeParse({ id: "l-1a2b3c4d", type: "learned", text: "Takes scope fixes.", level: "you", source: "learned", updatedAt: "2026-10-27T10:00:00Z" }).success).toBe(true);
    expect(schema().safeParse({ id: "l-1a2b3c4d", type: "learned", text: "x", level: "team", source: "learned", updatedAt: "x" }).success).toBe(false);
    expect(schema().safeParse({ id: "rulo", type: "sidekick", name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [{ id: "mentor" }], order: 1 }).success).toBe(true);
    expect(schema().safeParse({ id: "rulo", type: "sidekick", name: "Rulo", mark: "🦊", personality: "Direct.", purposes: [], order: 1 }).success).toBe(false);
    expect(schema().safeParse({ id: "s-main-rulo", type: "scope", scope: "main", sidekick: "rulo", on: false, purposeText: "No spec without AC." }).success).toBe(true);
    expect(schema().safeParse({ id: "settings", type: "settings", afterReply: false, headsUps: true, muted: { sidekick: ["vague"] }, learnedAt: "2026-10-27T10:00:00Z", lastDaily: "2026-10-27" }).success).toBe(true);
  });

  it("record types: missing fields and a misplaced source are refused", () => {
    expect(schema().safeParse({ id: "l-1a2b3c4d", type: "learned", text: "x", level: "you", updatedAt: "2026-10-27T10:00:00Z" }).success).toBe(false);
    expect(schema().safeParse({ id: "l-1a2b3c4d", type: "learned", text: "x", level: "you", source: { kind: "paste" }, updatedAt: "2026-10-27T10:00:00Z" }).success).toBe(false);
    expect(schema().safeParse({ id: "rulo", type: "sidekick", name: "Rulo", mark: "🦊", personality: "", purposes: [{ id: "mentor" }], order: 1, source: "person" }).success).toBe(false);
    expect(schema().safeParse({ id: "rulo", type: "sidekick", name: "Rulo", mark: "🦊", personality: "", purposes: [{ id: "mentor" }], order: 1, source: { kind: "paste" } }).success).toBe(true);
    expect(schema().safeParse({ id: "s-main-rulo", type: "scope", scope: "main", sidekick: "rulo" }).success).toBe(false);
    expect(schema().safeParse({ id: "rulo", type: "settings" }).success).toBe(false);
  });
});
