import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { type HarnessInput, SETUP_STEP_ID, defineHarness, hasSetup, interviewCollections, loadHarness, setupFormSpec, setupStepSchema, settingsSchema, z } from "../src";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../fake-agent/fixtures/setup-harness/harness.config.ts");

const profile = { scoped: false, single: true, schema: z.object({ name: z.string().min(1).max(40), goal: z.string().max(200), age: z.number().int().min(5).max(99).optional() }), agent: "write" as const };
const settings = {
  tab: "How I learn",
  fields: {
    tone: { schema: z.enum(["patient", "demanding"]), default: "patient", control: "segmented" as const, label: "Tone", options: { patient: "Patient", demanding: "Demanding" } },
    hintAfter: { schema: z.number().int().min(1).max(5), default: 2, control: "number" as const, label: "Hint after" },
  },
};
const base: HarnessInput = {
  id: "tutor",
  name: "Tutor",
  core: "^0.1.0",
  engines: ["claude"],
  folder: { suggested: "Documents/Tutor" },
  instructions: "./AGENTS.md",
  permissions: { edit: "none", exec: false, web: false },
  blocks: {},
  actions: {
    conocerte: { label: "Get to know you", prompt: "tasks/conocerte.md", cost: "medium", tier: "light" },
    practice: { label: "Practice", prompt: "tasks/practice.md", cost: "light" },
  },
  path: ["practice"],
  data: { profile },
  settings,
  author: "t",
};
const interviewStep = { id: "conocerte", kind: "interview" as const, label: "Get to know you", action: "conocerte", writes: "profile", required: true };
const componentStep = { id: "ready", kind: "component" as const, label: "Ready check", component: "ReadyStep" };
const steps = [
  interviewStep,
  { id: "estilo", kind: "form" as const, label: "How the AI talks", settings: ["tone", "hintAfter"] },
  { id: "goal", kind: "form" as const, label: "Your goal", collection: "profile", fields: ["goal", "age"] },
  componentStep,
];

/** Every issue of a manifest, as `path: message`; [] when it parses. */
function issues(input: HarnessInput): string[] {
  try {
    defineHarness(input);
    return [];
  } catch (e) {
    return (e as { issues: { path: PropertyKey[]; message: string }[] }).issues.map((i) => `${i.path.map(String).join(".")}: ${i.message}`);
  }
}

describe("setup steps in the manifest (setup-steps spec §3)", () => {
  it("D0: a manifest without setup has no setup and no interview actions", () => {
    const h = defineHarness(base);
    expect(h).not.toHaveProperty("setup");
    expect(hasSetup(h)).toBe(false);
    expect(interviewCollections(h)).toEqual({});
  });

  it("takes the three kinds; required defaults to false; an interview's action maps to its collection", () => {
    const h = defineHarness({ ...base, setup: steps });
    expect(h.setup?.map((s) => [s.id, s.kind, s.required])).toEqual([
      ["conocerte", "interview", true],
      ["estilo", "form", false],
      ["goal", "form", false],
      ["ready", "component", false],
    ]);
    expect(hasSetup(h)).toBe(true);
    expect(interviewCollections(h)).toEqual({ conocerte: "profile" });
  });

  it("step ids: the pattern, once each, at most eight steps", () => {
    expect(SETUP_STEP_ID.test("get-to-know")).toBe(true);
    expect(SETUP_STEP_ID.test("Get")).toBe(false);
    expect(issues({ ...base, setup: [componentStep, { ...componentStep, label: "Again" }] })).toEqual(['setup.1.id: Step "ready" is declared twice']);
    const many = Array.from({ length: 9 }, (_, i) => ({ ...componentStep, id: `s${i}` }));
    expect(issues({ ...base, setup: many })[0]).toMatch(/^setup: /);
    expect(issues({ ...base, setup: [] })[0]).toMatch(/^setup: /);
  });

  it("form: a collection with fields, or settings, never both or neither", () => {
    const form = { id: "f", kind: "form" as const, label: "F" };
    expect(issues({ ...base, setup: [form] })).toEqual(["setup.0: A form takes its fields from a collection (collection and fields) or from the settings (settings), not both"]);
    expect(issues({ ...base, setup: [{ ...form, collection: "profile", fields: ["goal"], settings: ["tone"] }] })).toEqual([
      "setup.0: A form takes its fields from a collection (collection and fields) or from the settings (settings), not both",
    ]);
    expect(issues({ ...base, setup: [{ ...form, collection: "profile" }] })).toEqual(["setup.0: A form over a collection names the collection and its fields"]);
  });

  it("form over a collection: declared, one app-wide record, known and drawable fields", () => {
    const form = { id: "f", kind: "form" as const, label: "F" };
    const data = {
      profile,
      notes: { scoped: false, key: "id", schema: z.object({ id: z.string() }), agent: "write" as const },
      topic: { scoped: true, single: true, schema: z.object({ name: z.string() }), agent: "write" as const },
      deep: { scoped: false, single: true, schema: z.object({ where: z.object({ city: z.string() }) }), agent: "write" as const },
    };
    expect(issues({ ...base, data, setup: [{ ...form, collection: "gone", fields: ["x"] }] })).toEqual(['setup.0.collection: Collection "gone" is not declared in data']);
    for (const name of ["notes", "topic"]) {
      expect(issues({ ...base, data, setup: [{ ...form, collection: name, fields: ["id"] }] })[0]).toBe(
        `setup.0.collection: A setup step keeps one app-wide record: "${name}" needs single: true and scoped: false`,
      );
    }
    expect(issues({ ...base, data, setup: [{ ...form, collection: "profile", fields: ["goal", "nope"] }] })).toEqual(['setup.0.fields: "nope" is not a field of "profile"']);
    expect(issues({ ...base, data, setup: [{ ...form, collection: "deep", fields: ["where"] }] })).toEqual(['setup.0.fields: The setup form can\'t draw "where"']);
    expect(issues({ ...base, data, setup: [{ ...form, collection: "profile", fields: ["goal", "age", "goal"] }] })).toEqual(['setup.0.fields: "goal" is listed twice']);
  });

  it("form over settings: the harness declares them, and each name is one of its fields", () => {
    const form = { id: "f", kind: "form" as const, label: "F", settings: ["tone", "volume"] };
    expect(issues({ ...base, setup: [form] })).toEqual(['setup.0.settings: "volume" is not a setting']);
    expect(issues({ ...base, setup: [{ ...form, settings: ["tone", "hintAfter", "tone"] }] })).toEqual(['setup.0.settings: "tone" is listed twice']);
    const { settings: _s, ...noSettings } = base;
    expect(issues({ ...noSettings, setup: [{ ...form, settings: ["tone"] }] })).toEqual(["setup.0.settings: Only a harness with settings can ask for them in a form"]);
  });

  it("interview: a known action off the path, light or standard, app-wide, once; it writes a one-record collection the agent may write", () => {
    const interview = interviewStep;
    expect(issues({ ...base, setup: [{ ...interview, action: "gone" }] })).toEqual(['setup.0.action: Unknown action "gone"']);
    expect(issues({ ...base, path: ["conocerte", "practice"], setup: [interview] })).toEqual(['setup.0.action: "conocerte" runs as a setup step: it can\'t be in the path']);
    const deep = { ...base.actions!, conocerte: { ...base.actions!.conocerte, tier: "deep" as const } };
    expect(issues({ ...base, actions: deep, setup: [interview] })).toEqual(["setup.0.action: An interview runs at tier light or standard"]);
    expect(issues({ ...base, scopes: { label: "topic", plural: "topics" }, setup: [interview] })).toEqual(['setup.0.action: An interview runs app-wide: set scope: "none" on "conocerte"']);
    expect(issues({ ...base, setup: [interview, { ...interview, id: "again" }] })).toEqual(['setup.1.action: "conocerte" already runs the interview "conocerte"']);
    const readOnly = { profile: { ...profile, agent: "read" as const } };
    expect(issues({ ...base, data: readOnly, setup: [interview] })).toEqual(['setup.0.writes: The agent writes "profile" during the interview: give it agent: "write"']);
  });

  it("component: a registrable name, and a declared collection when it says what it writes", () => {
    const component = componentStep;
    expect(issues({ ...base, setup: [{ ...component, component: "ready step" }] })[0]).toMatch(/^setup\.0\.component: /);
    expect(issues({ ...base, setup: [{ ...component, writes: "accounts" }] })).toEqual(['setup.0.writes: Collection "accounts" is not declared in data']);
  });

  it("setupFormSpec: a collection's fields as the input form draws them; settings with their labels and option labels", () => {
    const h = defineHarness({ ...base, setup: steps });
    const [, estilo, goal] = h.setup!;
    if (estilo.kind !== "form" || goal.kind !== "form") throw new Error("expected forms");
    expect(setupFormSpec(goal, h)).toEqual({
      fields: [
        { name: "goal", kind: "text", label: "Goal", optional: false, max: 200 },
        { name: "age", kind: "number", label: "Age", optional: true, min: 5, max: 99 },
      ],
    });
    expect(setupFormSpec(estilo, { data: {}, settings: settingsSchema.parse(settings) })).toEqual({
      fields: [
        { name: "tone", kind: "choice", label: "Tone", optional: false, options: ["patient", "demanding"], optionLabels: { patient: "Patient", demanding: "Demanding" } },
        { name: "hintAfter", kind: "number", label: "Hint after", optional: false, min: 1, max: 5 },
      ],
    });
  });

  it("the setup-harness fixture loads", async () => {
    const h = await loadHarness(fixture);
    expect(h.setup?.map((s) => s.id)).toEqual(["conocerte", "estilo", "goal", "ready"]);
  });

  it("the setup step kinds are form, interview, component and connect", () => {
    expect(setupStepSchema.options.map((o) => o.shape.kind.value).sort()).toEqual(["component", "connect", "form", "interview"]);
  });
});
