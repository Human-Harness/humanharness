import { describe, expect, it } from "vitest";
import { type Harness, RESERVED_COLLECTIONS, dataCollections, defineHarness } from "@humanharness/harness-sdk";
import {
  DEFAULT_SIDEKICK,
  SIDEKICK_MARKS,
  sidekickMark,
  SIDEKICK_COLLECTION,
  SIDEKICK_MIN_WORDS,
  SIDEKICK_MUTED_MAX,
  SIDEKICK_SETTINGS_ID,
  purposeMoments,
  sidekickSettings,
  speaksAt,
} from "../src/manifest";
import { sidekickCollection } from "../src/collection";
import { sidekickMinWords, sidekickMode, sidekickSchema, sidekickTips } from "../src/schema";

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
/** `mods.sidekick` as Sidekick reads it: the harness keeps it raw, the mod's schema parses it. */
const configOf = (h: Harness) => (h.mods?.sidekick === undefined ? undefined : sidekickSchema.parse(h.mods.sidekick));

describe("manifest sidekick", () => {
  it("D0: a manifest without mods.sidekick has no Sidekick config", () => {
    const h = defineHarness({ ...minimal });
    expect(h.mods).toBeUndefined();
    expect(configOf(h)).toBeUndefined();
    expect(sidekickMode(configOf(h), "anything")).toBe("auto");
    expect(sidekickTips(configOf(h))).toBeUndefined();
    expect(sidekickMinWords(configOf(h))).toBe(SIDEKICK_MIN_WORDS);
  });

  it("parses default, tips, actions and checks", () => {
    const h = defineHarness({
      ...minimal,
      actions: { draft: action, export: action },
      mods: { sidekick: { default: "on", tips: "Claims need a source.", actions: { draft: "always", export: "off" }, checks: { minWords: 4 } } },
    });
    expect(configOf(h)?.default).toBe("on");
    expect(sidekickMode(configOf(h), "draft")).toBe("always");
    expect(sidekickMode(configOf(h), "export")).toBe("off");
    expect(sidekickMode(configOf(h), undefined)).toBe("auto");
    expect(sidekickTips(configOf(h))).toBe("Claims need a source.");
    expect(sidekickMinWords(configOf(h))).toBe(4);
  });

  it("default is off when omitted", () => {
    expect(configOf(defineHarness({ ...minimal, mods: { sidekick: {} } }))?.default).toBe("off");
  });

  it("per-purpose tips: prompt-coach's for the prompt coach", () => {
    const h = defineHarness({ ...minimal, mods: { sidekick: { tips: { "prompt-coach": "Short prompts.", mentor: "Be kind." } } } });
    expect(sidekickTips(configOf(h))).toBe("Short prompts.");
    expect(sidekickTips(configOf(h), "mentor")).toBe("Be kind.");
  });

  it("refuses an unknown action, an unknown check and an unknown purpose", () => {
    expect(() => defineHarness({ ...minimal, mods: { sidekick: { actions: { nope: "auto" } } } })).toThrow(/nope/);
    expect(() => defineHarness({ ...minimal, mods: { sidekick: { checks: { maxWords: 3 } } } as never })).toThrow();
    expect(() => defineHarness({ ...minimal, mods: { sidekick: { tips: { wizard: "x" } } } as never })).toThrow();
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
    expect(schema.safeParse({ id: SIDEKICK_SETTINGS_ID, type: "sidekick", name: "S", mark: "s", personality: "", purposes: [{ id: "mentor" }], order: 1 }).success).toBe(false);
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
    const h = defineHarness({ ...minimal, mods: { sidekick: { default: "on" } } });
    expect(configOf(h)).toEqual({ default: "on" });
  });

  it("places: action-id pattern, unique", () => {
    expect(configOf(defineHarness({ ...minimal, mods: { sidekick: { places: [{ id: "terminal", label: "Terminal", description: "Agent output." }] } } }))?.places).toHaveLength(1);
    expect(() => defineHarness({ ...minimal, mods: { sidekick: { places: [{ id: "Bad", label: "x", description: "y" }] } } })).toThrow();
    expect(() => defineHarness({ ...minimal, mods: { sidekick: { places: [{ id: "t", label: "a", description: "b" }, { id: "t", label: "c", description: "d" }] } } })).toThrow(/unique/);
  });

  it("presets: known purposes, custom with text and known moments, personality within 1,500", () => {
    const ok = { name: "Guard", mark: "guardian" as const, personality: "Calm.", purposes: [{ id: "process-guard" as const }, { id: "custom" as const, text: "Watch the terminal.", moments: ["place:terminal"] }] };
    const h = defineHarness({ ...minimal, mods: { sidekick: { places: [{ id: "terminal", label: "Terminal", description: "x" }], presets: [ok] } } });
    expect(configOf(h)?.presets?.[0].name).toBe("Guard");
    expect(() => defineHarness({ ...minimal, mods: { sidekick: { presets: [{ ...ok, purposes: [{ id: "wizard" }] }] } } as never })).toThrow();
    expect(() => defineHarness({ ...minimal, mods: { sidekick: { presets: [{ ...ok, purposes: [{ id: "custom", text: "x", moments: ["place:nope"] }] }] } } })).toThrow(/place/);
    expect(() => defineHarness({ ...minimal, mods: { sidekick: { presets: [{ ...ok, personality: "x".repeat(1501) }] } } })).toThrow();
  });

  it("presets: names unique (adopting one finds it by name)", () => {
    const p = { name: "Guard", mark: "focus" as const, personality: "", purposes: [{ id: "focus" as const }] };
    expect(() => defineHarness({ ...minimal, mods: { sidekick: { presets: [p, { ...p, mark: "coach" as const }] } } })).toThrow(/unique/);
    expect(configOf(defineHarness({ ...minimal, mods: { sidekick: { presets: [p, { ...p, name: "Guard 2" }] } } }))?.presets).toHaveLength(2);
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
    expect(schema().safeParse({ id: "rulo", type: "sidekick", name: "Rulo", mark: "mentor" as const, personality: "Direct.", purposes: [{ id: "mentor" }], order: 1 }).success).toBe(true);
    expect(schema().safeParse({ id: "rulo", type: "sidekick", name: "Rulo", mark: "mentor" as const, personality: "Direct.", purposes: [], order: 1 }).success).toBe(false);
    expect(schema().safeParse({ id: "s-main-rulo", type: "scope", scope: "main", sidekick: "rulo", on: false, purposeText: "No spec without AC." }).success).toBe(true);
    expect(schema().safeParse({ id: "settings", type: "settings", afterReply: false, headsUps: true, muted: { sidekick: ["vague"] }, learnedAt: "2026-10-27T10:00:00Z", lastDaily: "2026-10-27" }).success).toBe(true);
  });

  it("muted: up to SIDEKICK_MUTED_MAX (20) kinds per sidekick", () => {
    const kinds = (n: number) => Array.from({ length: n }, (_, i) => `kind-${i}`);
    expect(SIDEKICK_MUTED_MAX).toBe(20);
    expect(schema().safeParse({ id: "settings", type: "settings", muted: { sidekick: kinds(20) } }).success).toBe(true);
    expect(schema().safeParse({ id: "settings", type: "settings", muted: { sidekick: kinds(21) } }).success).toBe(false);
  });

  it("record types: missing fields and a misplaced source are refused", () => {
    expect(schema().safeParse({ id: "l-1a2b3c4d", type: "learned", text: "x", level: "you", updatedAt: "2026-10-27T10:00:00Z" }).success).toBe(false);
    expect(schema().safeParse({ id: "l-1a2b3c4d", type: "learned", text: "x", level: "you", source: { kind: "paste" }, updatedAt: "2026-10-27T10:00:00Z" }).success).toBe(false);
    expect(schema().safeParse({ id: "rulo", type: "sidekick", name: "Rulo", mark: "mentor" as const, personality: "", purposes: [{ id: "mentor" }], order: 1, source: "person" }).success).toBe(false);
    expect(schema().safeParse({ id: "rulo", type: "sidekick", name: "Rulo", mark: "mentor" as const, personality: "", purposes: [{ id: "mentor" }], order: 1, source: { kind: "paste" } }).success).toBe(true);
    expect(schema().safeParse({ id: "s-main-rulo", type: "scope", scope: "main", sidekick: "rulo" }).success).toBe(false);
    expect(schema().safeParse({ id: "rulo", type: "settings" }).success).toBe(false);
  });
});

describe("sidekick marks are icon names (style guide §4, row 44)", () => {
  const schema = () => sidekickCollection().schema;
  const rec = (mark: string) => ({ id: "rulo", type: "sidekick", name: "Rulo", mark, personality: "", purposes: [{ id: "mentor" }], order: 1 });
  it("the record schema reads an emoji or a token as coach (stored data stays loadable) and accepts each icon name", () => {
    expect(schema().parse(rec("🦊")).mark).toBe("coach");
    expect(schema().parse(rec("--hh-accent")).mark).toBe("coach");
    expect(schema().parse(rec("spark")).mark).toBe("coach");
    for (const m of SIDEKICK_MARKS) expect(schema().safeParse(rec(m)).success, m).toBe(true);
  });
  it("a preset's mark must be an icon name", () => {
    const p = { name: "Guard", mark: "🛡️", personality: "", purposes: [{ id: "focus" as const }] };
    expect(() => defineHarness({ ...minimal, mods: { sidekick: { presets: [p] } } } as never)).toThrow();
  });
  it("the default sidekick's mark is coach", () => {
    expect(DEFAULT_SIDEKICK.mark).toBe("coach");
  });
  it("sidekickMark falls back to coach for anything that is not an icon name", () => {
    expect(sidekickMark("guardian")).toBe("guardian");
    expect(sidekickMark("🦊")).toBe("coach");
    expect(sidekickMark("spark")).toBe("coach");
    expect(sidekickMark(undefined)).toBe("coach");
  });
});
