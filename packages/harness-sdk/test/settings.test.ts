import { describe, expect, it } from "vitest";
import { type HarnessInput, defineHarness, z } from "../src";
import { base, declared, examples, hintAfter, nickname, tone } from "./settings-fixtures";

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

  it("refuses a missing default", () => {
    const { default: _omit, ...noDefault } = nickname;
    expect(issues(withField("nickname", noDefault))).toEqual(["settings.fields.nickname.default: Give a default value"]);
    expect(issues(withField("nickname", { ...noDefault, default: undefined }))).toEqual(["settings.fields.nickname.default: Give a default value"]);
  });

  const onSchema = "settings.fields.nickname.schema: Give the default in default, not on the schema (no .default() or .optional())";

  it("refuses a schema with .default(): the store would pin its default, not the declared one", () => {
    expect(issues(withField("nickname", { ...nickname, schema: z.string().default("x"), default: "y" }))).toEqual([onSchema]);
  });

  it("refuses a schema with .optional(), even with no default", () => {
    expect(issues(withField("nickname", { ...nickname, schema: z.string().optional() }))).toEqual([onSchema]);
    expect(issues(withField("nickname", { ...nickname, schema: z.string().optional(), default: undefined }))).toEqual([onSchema]);
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

  it("refuses a text the agent reads with no length cap: any length would reach AGENTS.md", () => {
    const uncapped = { ...nickname, schema: z.string(), agent: "Call the person {{value}}." };
    expect(issues(withField("nickname", uncapped))).toEqual(["settings.fields.nickname.schema: The agent reads this text: cap its length with .max(n)"]);
    expect(issues(withField("nickname", { ...uncapped, agent: { text: "Call the person {{ value }}." } }))).toHaveLength(1);
    expect(issues(withField("nickname", { ...uncapped, schema: z.string().max(40) }))).toEqual([]);
    // No value in the sentence, or no sentence: the length never reaches the agent.
    expect(issues(withField("nickname", { ...uncapped, agent: "The person has a nickname." }))).toEqual([]);
    expect(issues(withField("nickname", { ...uncapped, agent: false }))).toEqual([]);
    expect(issues(withField("nickname", { ...nickname, schema: z.string() }))).toEqual([]);
  });

  it("refuses a bad field name, the reserved `modes`, and no fields at all", () => {
    expect(issues(withField("Bad-name", nickname))[0]).toMatch(/^settings\.fields\.Bad-name/);
    expect(issues(withField("modes", nickname))).toEqual(['settings.fields.modes: "modes" is reserved for mode settings']);
    expect(issues({ tab: "Mine", fields: {} })).toEqual(["settings.fields: Declare at least one setting"]);
  });
});
