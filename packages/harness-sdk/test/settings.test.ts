import { describe, expect, it } from "vitest";
import { type HarnessInput, defineHarness, z } from "../src";

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

export const tone = {
  schema: z.enum(["patient", "neutral", "demanding"]),
  default: "patient",
  section: "voice",
  control: "segmented" as const,
  label: "Tone",
  options: { patient: "Patient", neutral: "Neutral", demanding: "Demanding" },
  agent: "Use a {{value:label}} tone.",
};
export const hintAfter = {
  schema: z.number().int().min(1).max(5),
  default: 2,
  section: "help",
  control: "number" as const,
  label: "Hint after",
  unit: "tries",
  agent: "Give a hint after {{value}} failed tries, not before.",
  advanced: true,
};
export const examples = {
  schema: z.boolean(),
  default: true,
  section: "help",
  control: "toggle" as const,
  label: "Show worked examples",
  agent: { text: "Do not show worked examples.", onlyWhenChanged: true },
};
export const nickname = { schema: z.string().max(40), default: "", control: "text" as const, label: "What the app calls you", help: "Only the app's screens use it." };
export const declared = {
  tab: "How I learn",
  sections: [
    { id: "voice", label: "How the AI talks" },
    { id: "help", label: "Help" },
  ],
  fields: { tone, hintAfter, examples, nickname },
};

/** The manifest issues of `settings`, as "path: message". */
function issues(settings: unknown): string[] {
  try {
    defineHarness({ ...base, settings: settings as HarnessInput["settings"] });
    return [];
  } catch (err) {
    return (err as z.ZodError).issues.map((i) => `${i.path.join(".")}: ${i.message}`);
  }
}
const withField = (name: string, field: Record<string, unknown>) => ({ ...declared, fields: { ...declared.fields, [name]: field } });

describe("manifest settings", () => {
  it("keeps a valid declaration: tab, sections and fields in order", () => {
    const h = defineHarness({ ...base, settings: declared });
    expect(h.settings?.tab).toBe("How I learn");
    expect(h.settings?.sections.map((s) => s.id)).toEqual(["voice", "help"]);
    expect(Object.keys(h.settings?.fields ?? {})).toEqual(["tone", "hintAfter", "examples", "nickname"]);
    expect(h.settings?.fields.tone.schema).toBeInstanceOf(z.ZodEnum);
  });

  it("D0: a harness with no settings has none", () => {
    expect(defineHarness(base).settings).toBeUndefined();
  });

  it("sections are optional; a field with no section is fine", () => {
    expect(issues({ tab: "Mine", fields: { nickname } })).toEqual([]);
  });

  it("refuses a default that doesn't match its schema", () => {
    expect(issues(withField("tone", { ...tone, default: "loud" }))).toEqual(["settings.fields.tone.default: The default does not match the schema"]);
  });

  it("refuses an undefined default, even when an optional or defaulted schema would take it", () => {
    const { default: _omit, ...noDefault } = nickname;
    expect(issues(withField("nickname", noDefault))).toHaveLength(1);
    expect(issues(withField("nickname", { ...noDefault, schema: z.string().optional(), default: undefined }))).toEqual(["settings.fields.nickname.default: Give a default value"]);
    expect(issues(withField("nickname", { ...noDefault, schema: z.string().default("x"), default: undefined }))).toEqual(["settings.fields.nickname.default: Give a default value"]);
  });

  it("refuses a section that isn't declared, and a section declared twice", () => {
    expect(issues(withField("tone", { ...tone, section: "nope" }))).toEqual(['settings.fields.tone.section: Section "nope" is not declared in sections']);
    expect(issues({ ...declared, sections: [...declared.sections, { id: "help", label: "Again" }] })).toEqual(['settings.sections.2.id: Section "help" is declared twice']);
  });

  it("refuses a control whose type doesn't fit", () => {
    expect(issues(withField("tone", { ...tone, control: "number" }))).toEqual(["settings.fields.tone.control: The number control needs a z.number() schema"]);
    expect(issues(withField("examples", { ...examples, control: "segmented" }))).toEqual(["settings.fields.examples.control: The segmented control needs a z.enum([...]) schema"]);
    expect(issues(withField("nickname", { ...nickname, control: "toggle" }))).toEqual(["settings.fields.nickname.control: The toggle control needs a z.boolean() schema"]);
  });

  it("refuses an options key that is not a value", () => {
    expect(issues(withField("tone", { ...tone, options: { ...tone.options, loud: "Loud" } }))).toEqual(['settings.fields.tone.options.loud: "loud" is not a value of the schema']);
    expect(issues(withField("examples", { ...examples, options: { yes: "Yes" } }))).toEqual([
      'settings.fields.examples.options.yes: "yes" is not a value of the schema (a toggle\'s are "true" and "false")',
    ]);
    expect(issues(withField("hintAfter", { ...hintAfter, options: { "2": "Two" } }))).toEqual(["settings.fields.hintAfter.options: Only a segmented, select or toggle control has options"]);
  });

  it("refuses a placeholder other than {{value}} and {{value:label}}, and a label where there are no options", () => {
    expect(issues(withField("tone", { ...tone, agent: "Use a {{tone}} tone." }))).toEqual(["settings.fields.tone.agent: Unknown placeholder {{tone}}: use {{value}} or {{value:label}}"]);
    expect(issues(withField("hintAfter", { ...hintAfter, agent: "After {{ value:label }} tries." }))).toEqual([
      "settings.fields.hintAfter.agent: {{value:label}} needs a segmented, select or toggle control: use {{value}}",
    ]);
    expect(issues(withField("tone", { ...tone, agent: "Use a {{ value }} tone." }))).toEqual([]);
  });

  it("refuses a bad field name, the reserved `modes`, and no fields at all", () => {
    expect(issues(withField("Bad-name", nickname))[0]).toMatch(/^settings\.fields\.Bad-name/);
    expect(issues(withField("modes", nickname))).toEqual(['settings.fields.modes: "modes" is reserved for mode settings']);
    expect(issues({ tab: "Mine", fields: {} })).toEqual(["settings.fields: Declare at least one setting"]);
  });
});
