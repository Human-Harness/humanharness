import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { type HarnessInput, PHASE_ID, defineHarness, hasPhases, loadHarness, phaseIds, phaseModes } from "../src";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "hh-phases-"));
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

const base: HarnessInput = {
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Tutor" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  author: "t",
};
const modes = { socratic: { label: "Socratic", brief: "modes/socratic.md" }, feynman: { label: "Feynman", brief: "modes/feynman.md" } };
const phases = [
  { id: "warmup", label: "Warm-up", brief: "phases/warmup.md", auto: true, modes: "none" as const },
  { id: "main", label: "Main block", brief: "phases/main.md", modes: ["socratic"] },
  { id: "close", label: "Close", brief: "phases/close.md", close: true as const },
];
const session = { label: "Session", prompt: "tasks/session.md", cost: "medium" as const, modes: ["socratic", "feynman"], phases };
const quiz = { label: "Quiz", prompt: "tasks/quiz.md", cost: "light" as const };

const issues = (input: HarnessInput): string[] => {
  try {
    defineHarness(input);
    return [];
  } catch (err) {
    return (err as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
  }
};

describe("phases in the manifest", () => {
  it("declares phases and a time box on an action; without them nothing is added (D0)", () => {
    const h = defineHarness({ ...base, modes, actions: { session: { ...session, timeBox: { options: [15, 30, 45], wrapUpAt: 0.85 } }, quiz } });
    expect(h.actions.session.phases?.map((p) => p.id)).toEqual(["warmup", "main", "close"]);
    expect(h.actions.session.timeBox).toEqual({ options: [15, 30, 45], default: null, wrapUpAt: 0.85 });
    expect(h.actions.quiz).not.toHaveProperty("phases");
    expect(h.actions.quiz).not.toHaveProperty("timeBox");
    expect(hasPhases(h)).toBe(true);
    expect(phaseIds(h)).toEqual(["warmup", "main", "close"]);
    expect(hasPhases(defineHarness({ ...base, actions: { quiz } }))).toBe(false);
    expect(PHASE_ID.test("main_2")).toBe(true);
    expect(PHASE_ID.test("Main")).toBe(false);
  });

  it("phaseModes: absent or any is every mode, none is none, a list is those", () => {
    const action = { modes: ["socratic", "feynman"] };
    expect(phaseModes(action, undefined)).toEqual(["socratic", "feynman"]);
    expect(phaseModes(action, { modes: "any" })).toEqual(["socratic", "feynman"]);
    expect(phaseModes(action, {})).toEqual(["socratic", "feynman"]);
    expect(phaseModes(action, { modes: "none" })).toEqual([]);
    expect(phaseModes(action, { modes: ["feynman"] })).toEqual(["feynman"]);
    expect(phaseModes({}, { modes: "any" })).toEqual([]);
  });

  it("refuses broken declarations, with their paths", () => {
    const dup = [phases[0], { ...phases[1], id: "warmup" }, phases[2]];
    expect(issues({ ...base, modes, actions: { session: { ...session, phases: dup } } })).toEqual(['actions.session.phases.1.id: Phase "warmup" is declared twice']);
    const early = [{ ...phases[0], close: true as const }, phases[1], phases[2]];
    expect(issues({ ...base, modes, actions: { session: { ...session, phases: early } } })).toEqual(["actions.session.phases.0.close: Only the last phase can be the close phase"]);
    const strange = [phases[0], { ...phases[1], modes: ["nope"] }, phases[2]];
    expect(issues({ ...base, modes, actions: { session: { ...session, phases: strange } } })).toEqual(['actions.session.phases.1.modes: "nope" is not one of this action\'s modes']);
    const noModes = { ...session, modes: undefined, phases: [phases[0], { ...phases[1], modes: ["socratic"] }] };
    expect(issues({ ...base, modes, actions: { session: noModes } })).toEqual(["actions.session.phases.1.modes: Only an action with modes can list the modes a phase allows"]);
    expect(issues({ ...base, actions: { quiz: { ...quiz, timeBox: { options: [15, 15] } } } })).toEqual(["actions.quiz.timeBox.options: Each length is offered once"]);
    expect(issues({ ...base, actions: { quiz: { ...quiz, timeBox: { options: [15, 30], default: 20 } } } })).toEqual([
      "actions.quiz.timeBox.default: The default is one of the options, or null",
    ]);
    expect(issues({ ...base, actions: { quiz: { ...quiz, timeBox: { options: [0] } } } })[0]).toMatch(/^actions\.quiz\.timeBox\.options\.0: /);
    expect(issues({ ...base, actions: { quiz: { ...quiz, timeBox: { options: [15], wrapUpAt: 1.5 } } } })[0]).toMatch(/^actions\.quiz\.timeBox\.wrapUpAt: /);
    expect(issues({ ...base, actions: { quiz: { ...quiz, phases: [] } } })[0]).toMatch(/^actions\.quiz\.phases: /);
    // A time box alone is fine; "any" and "none" without the action's modes are harmless.
    expect(issues({ ...base, actions: { quiz: { ...quiz, timeBox: { options: [10], default: 10 }, phases: [{ id: "a", label: "A", modes: "none" }] } } })).toEqual([]);
  });
});

describe("loadHarness and phase briefs", () => {
  it("refuses a phase brief outside the harness folder", async () => {
    const dir = fs.mkdtempSync(path.join(root, "t-"));
    const file = path.join(dir, "harness.config.mjs");
    const manifest = { ...base, actions: { quiz: { ...quiz, phases: [{ id: "far", label: "Far", brief: "../../outside.md" }] } } };
    fs.writeFileSync(file, `export default ${JSON.stringify(manifest)};`);
    await expect(loadHarness(file)).rejects.toThrow("Path escapes the harness folder: ../../outside.md");
  });
});
