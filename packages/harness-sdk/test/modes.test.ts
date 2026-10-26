import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type HarnessAction, type HarnessInput, DEFAULT_MODE_WORDS, MODE_ID, TIERS, defaultModeOf, defineHarness, hasModes, loadHarness, tierBelow, z } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-modes-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

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
const modes = {
  socratic: { label: "Socratic", description: "Questions first.", brief: "modes/socratic.md", recommend: "One key idea to discover." },
  feynman: { label: "Feynman", brief: "modes/feynman.md" },
  worked: { label: "Worked examples", brief: "modes/worked.md", minTier: "deep" as const },
};
const study = { label: "Study", prompt: "tasks/study.md", cost: "medium" as const, modes: ["socratic", "feynman", "worked"] };
const quiz: HarnessAction = { label: "Quiz", prompt: "tasks/quiz.md", cost: "light" };
const questions = {
  schema: z.enum(["few", "many"]),
  default: "few",
  control: "segmented" as const,
  label: "Questions",
  options: { few: "Few", many: "Many" },
  agent: "Ask {{value:label}} questions before explaining.",
};

const issues = (input: HarnessInput): string[] => {
  try {
    defineHarness(input);
    return [];
  } catch (err) {
    return (err as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
  }
};

describe("modes in the manifest", () => {
  it("declares modes and the actions that accept them; without them, modes is {} (D0)", () => {
    const h = defineHarness({ ...base, modes, actions: { study: { ...study, defaultMode: "feynman" }, quiz } });
    expect(h.modes.worked).toEqual({ label: "Worked examples", brief: "modes/worked.md", minTier: "deep" });
    expect(h.actions.study.modes).toEqual(["socratic", "feynman", "worked"]);
    expect(h.actions.quiz).not.toHaveProperty("modes");
    expect(hasModes(h)).toBe(true);
    const plain = defineHarness(base);
    expect(plain.modes).toEqual({});
    expect(hasModes(plain)).toBe(false);
  });

  it("starts with a recommendation by default; null without modes", () => {
    expect(defaultModeOf(study)).toBe("recommend");
    expect(defaultModeOf({ ...study, defaultMode: "ask" })).toBe("ask");
    expect(defaultModeOf({ ...study, defaultMode: "worked" })).toBe("worked");
    expect(defaultModeOf(quiz)).toBeNull();
    expect(DEFAULT_MODE_WORDS).toEqual(["recommend", "ask"]);
    expect(MODE_ID.test("worked_2")).toBe(true);
    expect(MODE_ID.test("Worked")).toBe(false);
  });

  it("compares tiers in their order", () => {
    expect(TIERS).toEqual(["light", "standard", "deep"]);
    expect(tierBelow("standard", "deep")).toBe(true);
    expect(tierBelow("deep", "deep")).toBe(false);
    expect(tierBelow("deep", "light")).toBe(false);
  });

  it("refuses broken declarations, with their paths", () => {
    expect(issues({ ...base, modes: { ...modes, recommend: { label: "R", brief: "r.md" } } })).toEqual([
      'modes.recommend: "recommend" is a defaultMode word: use another mode id',
    ]);
    expect(issues({ ...base, modes, actions: { study: { ...study, modes: ["socratic", "nope"] } } })).toEqual(['actions.study.modes: Unknown mode "nope"']);
    expect(issues({ ...base, modes, actions: { study: { ...study, modes: ["socratic", "socratic"] } } })).toEqual(['actions.study.modes: "socratic" is listed twice']);
    expect(issues({ ...base, modes, actions: { quiz: { ...quiz, defaultMode: "socratic" } } })).toEqual(["actions.quiz.defaultMode: Only an action with modes has a defaultMode"]);
    expect(issues({ ...base, modes, actions: { study: { ...study, modes: ["socratic"], defaultMode: "feynman" } } })).toEqual([
      'actions.study.defaultMode: "feynman" is not one of this action\'s modes: use one of them, "recommend" or "ask"',
    ]);
    expect(issues({ ...base, modes, actions: { study: { ...study, defaultMode: "ask" } } })).toEqual([]);
    expect(issues({ ...base, modes: { ...modes, worked: { ...modes.worked, minTier: "huge" as "deep" } } })[0]).toMatch(/^modes\.worked\.minTier: /);
    expect(issues({ ...base, modes: { Bad: modes.feynman } })[0]).toMatch(/^modes/);
    expect(issues({ ...base, modes, actions: { study: { ...study, modes: [] } } })[0]).toMatch(/^actions\.study\.modes: /);
  });

  it("mode settings use the settings' field checks, need the harness's Settings tab, and have no sections", () => {
    const tab = { tab: "How I learn", fields: {} };
    const socratic = (field: typeof questions & { section?: string }) => ({ ...modes, socratic: { ...modes.socratic, settings: { questions: field } } });
    expect(issues({ ...base, settings: tab, modes: socratic(questions) })).toEqual([]);
    expect(issues({ ...base, modes: socratic(questions) })).toEqual([
      "modes.socratic.settings: Mode settings are drawn in the harness's Settings tab: declare settings with its tab",
    ]);
    expect(issues({ ...base, settings: tab, modes: socratic({ ...questions, section: "voice" }) })).toEqual([
      "modes.socratic.settings.questions.section: Mode settings are grouped by their mode: drop section",
    ]);
    expect(issues({ ...base, settings: tab, modes: socratic({ ...questions, default: "lots" }) })).toEqual([
      "modes.socratic.settings.questions.default: The default does not match the schema",
    ]);
    // Without any mode setting, an empty tab is still refused (harness-settings spec §3).
    expect(issues({ ...base, settings: tab, modes })).toEqual(["settings.fields: Declare at least one setting"]);
  });
});

describe("loadHarness and mode briefs", () => {
  it("refuses a mode brief outside the harness folder", async () => {
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const file = path.join(dir, "harness.config.mjs");
    const manifest = { ...base, modes: { far: { label: "Far", brief: "../../outside.md" } } };
    fs.writeFileSync(file, `export default ${JSON.stringify(manifest)};`);
    await expect(loadHarness(file)).rejects.toThrow("Path escapes the harness folder: ../../outside.md");
  });
});
