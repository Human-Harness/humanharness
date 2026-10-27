import { describe, expect, it } from "vitest";
import {
  type HarnessInput,
  SETTINGS_COLLECTION,
  dataCollections,
  defineHarness,
  modeSentences,
  modeSettingKey,
  settingRef,
  settingsCollection,
  settingsSentences,
  settingsValues,
  settingsView,
  withSetting,
  z,
} from "../src";

const base: HarnessInput = {
  id: "coach",
  name: "Coach",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Coach" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  author: "t",
};
const tone = { schema: z.enum(["patient", "neutral"]), default: "patient", control: "segmented" as const, label: "Tone", agent: "Use a {{value}} tone." };
const questions = {
  schema: z.enum(["few", "many"]),
  default: "few",
  control: "segmented" as const,
  label: "Questions",
  options: { few: "Few", many: "Many" },
  agent: "Ask {{value:label}} questions before explaining.",
};
const steps = { schema: z.number().int().min(1).max(5), default: 3, control: "number" as const, label: "Steps", advanced: true, agent: "Use {{value}} steps." };
const h = defineHarness({
  ...base,
  settings: { tab: "How I learn", fields: { tone } },
  modes: {
    socratic: { label: "Socratic", brief: "s.md", settings: { questions, steps } },
    feynman: { label: "Feynman", brief: "f.md" },
  },
});

describe("mode settings", () => {
  it("are keyed <mode>.<field> and found by key; a top-level name or an unknown key is not a mode setting", () => {
    expect(modeSettingKey("socratic", "questions")).toBe("socratic.questions");
    expect(settingRef(h.settings!, h.modes, "socratic.questions")).toMatchObject({ key: "socratic.questions", mode: "socratic", name: "questions" });
    expect(settingRef(h.settings!, h.modes, "tone")).toMatchObject({ key: "tone", name: "tone" });
    expect(settingRef(h.settings!, h.modes, "tone")).not.toHaveProperty("mode");
    for (const bad of ["feynman.questions", "socratic.nope", "nope", "socratic", "constructor", "socratic.constructor", "a.b.c"]) {
      expect(settingRef(h.settings!, h.modes, bad)).toBeNull();
    }
  });

  it("are stored under modes.<mode>, only when changed; a default removes the key and empty objects go", () => {
    const q = settingRef(h.settings!, h.modes, "socratic.questions")!;
    const t = settingRef(h.settings!, h.modes, "tone")!;
    const one = withSetting({ tone: "neutral" }, q, "many");
    expect(one).toEqual({ tone: "neutral", modes: { socratic: { questions: "many" } } });
    expect(withSetting(one, q, "few")).toEqual({ tone: "neutral" });
    expect(withSetting(null, t, "neutral")).toEqual({ tone: "neutral" });
    expect(withSetting({ tone: "neutral" }, t, "patient")).toEqual({});
  });

  it("read with their defaults under dotted keys; a bad stored value falls back field by field", () => {
    expect(settingsValues(h.settings!, null, h.modes)).toEqual({ tone: "patient", "socratic.questions": "few", "socratic.steps": 3 });
    expect(settingsValues(h.settings!, { modes: { socratic: { questions: "many", steps: 99 } } }, h.modes)).toEqual({
      tone: "patient",
      "socratic.questions": "many",
      "socratic.steps": 3,
    });
    // D0: without modes, exactly as before.
    expect(settingsValues(h.settings!, { tone: "neutral" })).toEqual({ tone: "neutral" });
  });

  it("never reach AGENTS.md; a mode's own sentences are filled for its brief", () => {
    const values = settingsValues(h.settings!, { modes: { socratic: { questions: "many" } } }, h.modes);
    expect(settingsSentences(h.settings!, values)).toEqual(["Use a patient tone."]);
    expect(modeSentences(h.modes, "socratic", values)).toEqual(["Ask Many questions before explaining.", "Use 3 steps."]);
    expect(modeSentences(h.modes, "feynman", values)).toEqual([]);
    expect(modeSentences(h.modes, "nope", values)).toEqual([]);
  });

  it("add a modes key to the settings collection only when some mode has settings (D0)", () => {
    const store = settingsCollection(h.settings!, h.modes);
    expect(store.schema.safeParse({ tone: "neutral", modes: { socratic: { questions: "many" } } }).success).toBe(true);
    expect(store.schema.safeParse({ modes: { socratic: { questions: "lots" } } }).success).toBe(false);
    expect(Object.keys(dataCollections(h))).toEqual([SETTINGS_COLLECTION]);
    const plain = defineHarness({ ...base, settings: { tab: "Mine", fields: { tone } } });
    expect(Object.keys((settingsCollection(plain.settings!, plain.modes).schema as z.ZodObject).shape)).toEqual(["tone"]);
  });

  it("are drawn in one section per mode, after the harness's own", () => {
    const view = settingsView(h.settings!, h.modes);
    expect(view.sections).toEqual([{ id: "mode:socratic", label: "Socratic" }]);
    expect(view.fields.map((f) => [f.name, f.section ?? null, f.mode ?? null])).toEqual([
      ["tone", null, null],
      ["socratic.questions", "mode:socratic", "socratic"],
      ["socratic.steps", "mode:socratic", "socratic"],
    ]);
    expect(view.fields[2]).toMatchObject({ advanced: true, min: 1, max: 5, agent: true });
    // D0: without modes the view is exactly as before.
    expect(settingsView(h.settings!)).toEqual({ tab: "How I learn", sections: [], fields: [view.fields[0]] });
  });
});
