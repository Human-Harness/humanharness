import { describe, expect, it } from "vitest";
import {
  SETTINGS_COLLECTION,
  agentSettings,
  dataCollections,
  settingSentence,
  settingsSchema,
  settingsSentences,
  settingsValues,
  settingsView,
  z,
} from "../src";
import { declared } from "./settings.test";

const settings = settingsSchema.parse(declared);

describe("settingsValues", () => {
  it("fills every field: the stored value when valid, else the default", () => {
    expect(settingsValues(settings, null)).toEqual({ tone: "patient", hintAfter: 2, examples: true, nickname: "" });
    expect(settingsValues(settings, { tone: "demanding", hintAfter: 9, other: 1 })).toEqual({ tone: "demanding", hintAfter: 2, examples: true, nickname: "" });
    expect(settingsValues(settings, ["not", "a", "record"])).toEqual(settingsValues(settings, {}));
  });

  it("never reads an inherited key as a stored value", () => {
    const stored = Object.create({ tone: "demanding" }) as Record<string, unknown>;
    expect(settingsValues(settings, stored).tone).toBe("patient");
  });
});

describe("settingsSentences", () => {
  it("fills {{value}} and {{value:label}}; skips UI-only fields and unchanged onlyWhenChanged ones", () => {
    expect(settingsSentences(settings, settingsValues(settings, null))).toEqual(["Use a Patient tone.", "Give a hint after 2 failed tries, not before."]);
    expect(settingsSentences(settings, settingsValues(settings, { tone: "demanding", examples: false, hintAfter: 4 }))).toEqual([
      "Use a Demanding tone.",
      "Give a hint after 4 failed tries, not before.",
      "Do not show worked examples.",
    ]);
  });

  it("{ all: true } keeps the onlyWhenChanged ones (check measures the longest section)", () => {
    expect(settingsSentences(settings, settingsValues(settings, null), { all: true })).toContain("Do not show worked examples.");
  });

  it("a value with no label shows as itself; a boolean reads on/off; whitespace folds", () => {
    const field = { ...settings.fields.tone, options: {}, agent: "Tone:\n  {{value:label}}." };
    expect(settingSentence(field, "neutral")).toBe("Tone: neutral.");
    const toggle = settingsSchema.parse({ tab: "x", fields: { on: { schema: z.boolean(), default: false, control: "toggle", label: "On", agent: "Switch is {{value}}." } } });
    expect(settingSentence(toggle.fields.on, true)).toBe("Switch is on.");
  });

  it("agentSettings lists the fields the agent reads", () => {
    expect(agentSettings(settings)).toEqual(["tone", "hintAfter", "examples"]);
  });
});

describe("dataCollections", () => {
  it("D0: without settings it is the harness's own collections, the same object", () => {
    const data = {};
    expect(dataCollections({ data })).toBe(data);
  });

  it("adds the reserved collection: app-wide, one record, hidden from the agent, optional fields", () => {
    const all = dataCollections({ data: {}, settings });
    const c = all[SETTINGS_COLLECTION];
    expect(c).toMatchObject({ scoped: false, single: true, agent: "none", context: false });
    expect(c.schema.safeParse({}).success).toBe(true);
    expect(c.schema.safeParse({ tone: "loud" }).success).toBe(false);
    expect(c.schema.parse({ tone: "neutral", extra: 1 })).toEqual({ tone: "neutral" });
  });
});

describe("settingsView", () => {
  it("is plain data in manifest order: options with labels, bounds, advanced, agent", () => {
    const view = settingsView(settings);
    expect(view.tab).toBe("How I learn");
    expect(view.sections).toEqual(declared.sections);
    expect(view.fields.map((f) => f.name)).toEqual(["tone", "hintAfter", "examples", "nickname"]);
    expect(view.fields[0]).toEqual({
      name: "tone",
      control: "segmented",
      label: "Tone",
      section: "voice",
      default: "patient",
      options: [
        { value: "patient", label: "Patient" },
        { value: "neutral", label: "Neutral" },
        { value: "demanding", label: "Demanding" },
      ],
      agent: true,
    });
    expect(view.fields[1]).toMatchObject({ control: "number", unit: "tries", advanced: true, min: 1, max: 5, default: 2 });
    expect(view.fields[3]).toEqual({ name: "nickname", control: "text", label: "What the app calls you", help: "Only the app's screens use it.", default: "", max: 40 });
    expect(JSON.parse(JSON.stringify(view))).toEqual(view);
  });
});
