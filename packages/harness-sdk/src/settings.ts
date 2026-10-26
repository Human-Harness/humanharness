import { z } from "zod";
import { inputFields } from "./input";

/** The core's controls for a setting (harness-settings spec §3). */
export const SETTING_CONTROLS = ["segmented", "select", "toggle", "number", "text"] as const;
export type SettingControl = (typeof SETTING_CONTROLS)[number];

/** A setting's name: a key of the stored record (camelCase, as `hintAfter`). */
export const SETTING_NAME = /^[a-z][a-zA-Z0-9]{0,39}$/;
/** Names the core keeps: `modes` will hold mode settings (spec §6, with task modes). */
export const RESERVED_SETTINGS: readonly string[] = ["modes"];
const SECTION_ID = /^[a-z][a-z0-9-]{0,39}$/;
/** A placeholder in an agent sentence: `{{value}}` or `{{value:label}}`, spaces allowed inside the braces. */
export const SETTING_PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g;
/** The controls whose values have labels (`options`), so `{{value:label}}` means something. */
const LABELLED: readonly SettingControl[] = ["segmented", "select", "toggle"];
/** What each control needs, as the core form infers it from the zod type (input-blocks `inputFields`). */
const CONTROL_KINDS: Record<SettingControl, readonly string[]> = {
  segmented: ["choice"],
  select: ["choice"],
  toggle: ["boolean"],
  number: ["number"],
  text: ["text", "longText"],
};
const CONTROL_TYPES: Record<SettingControl, string> = {
  segmented: "a z.enum([...])",
  select: "a z.enum([...])",
  toggle: "a z.boolean()",
  number: "a z.number()",
  text: "a z.string()",
};

const text = z.string().min(1);

const agentSchema = z.union([z.literal(false), text.max(300), z.object({ text: text.max(300), onlyWhenChanged: z.boolean().optional() })]);

const fieldSchema = z.object({
  /** A zod type: z.enum (segmented, select), z.boolean (toggle), z.number (number) or z.string (text). */
  schema: z.custom<z.ZodType>((s) => s instanceof z.ZodType, { message: "Expected a zod schema" }),
  /** The value until the person changes it; it must match `schema`. */
  default: z.unknown(),
  /** A section id from `sections`; absent: drawn first, outside any section. */
  section: z.string().optional(),
  control: z.enum(SETTING_CONTROLS),
  label: text.max(80),
  /** One line under the control. */
  help: text.max(200).optional(),
  /** Shown after a number ("tries"). */
  unit: text.max(40).optional(),
  /** Labels of the values (segmented, select; "true"/"false" for a toggle). A value with none shows as itself. */
  options: z.record(z.string(), text.max(80)).optional(),
  /**
   * The agent's sentence (spec §5): `{{value}}`, and `{{value:label}}` for the value's label. Absent or false:
   * UI-only, the agent never sees it. `onlyWhenChanged`: left out while the value is the default.
   */
  agent: agentSchema.optional(),
  /** Under "More options", closed by default. */
  advanced: z.boolean().optional(),
});

/** What a control would draw for `schema`: its kind, enum options and bounds (the input-blocks inference). */
export function inferSetting(schema: z.ZodType) {
  return inputFields({ input: z.object({ value: schema }), schema: z.object({}) })[0];
}

/** The manifest's `settings` (harness-settings spec §3). */
export const settingsSchema = z
  .object({
    /** The name of the Settings tab, in English. */
    tab: text.max(40),
    sections: z.array(z.object({ id: z.string().regex(SECTION_ID), label: text.max(80) })).default([]),
    fields: z.record(z.string().regex(SETTING_NAME), fieldSchema),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    if (Object.keys(s.fields).length === 0) issue(["fields"], "Declare at least one setting");
    const sections = new Set<string>();
    for (const [i, section] of s.sections.entries()) {
      if (sections.has(section.id)) issue(["sections", i, "id"], `Section "${section.id}" is declared twice`);
      sections.add(section.id);
    }
    for (const [name, f] of Object.entries(s.fields)) {
      const at = (...rest: (string | number)[]) => ["fields", name, ...rest];
      if (RESERVED_SETTINGS.includes(name)) issue(at(), `"${name}" is reserved for mode settings`);
      if (f.section !== undefined && !sections.has(f.section)) issue(at("section"), `Section "${f.section}" is not declared in sections`);
      if (!(f.schema instanceof z.ZodType)) continue;
      const inferred = inferSetting(f.schema);
      if (!CONTROL_KINDS[f.control].includes(inferred.kind ?? "")) {
        issue(at("control"), `The ${f.control} control needs ${CONTROL_TYPES[f.control]} schema`);
        continue;
      }
      if (!f.schema.safeParse(f.default).success) issue(at("default"), "The default does not match the schema");
      if (f.options !== undefined) {
        if (!LABELLED.includes(f.control)) issue(at("options"), "Only a segmented, select or toggle control has options");
        else {
          const toggle = f.control === "toggle";
          const values = toggle ? ["true", "false"] : (inferred.options ?? []);
          for (const key of Object.keys(f.options)) {
            if (!values.includes(key)) issue(at("options", key), `"${key}" is not a value of the schema${toggle ? ' (a toggle\'s are "true" and "false")' : ""}`);
          }
        }
      }
      const template = agentText(f.agent);
      if (template === null) continue;
      for (const m of template.matchAll(SETTING_PLACEHOLDER)) {
        if (m[1] !== "value" && m[1] !== "value:label") issue(at("agent"), `Unknown placeholder {{${m[1]}}}: use {{value}} or {{value:label}}`);
        else if (m[1] === "value:label" && !LABELLED.includes(f.control)) issue(at("agent"), "{{value:label}} needs a segmented, select or toggle control: use {{value}}");
      }
    }
  });

export type HarnessSettings = z.output<typeof settingsSchema>;
export type HarnessSettingsInput = z.input<typeof settingsSchema>;
export type SettingField = HarnessSettings["fields"][string];

/** A field's sentence template, or null for a UI-only field. */
export function agentText(agent: SettingField["agent"]): string | null {
  if (agent === undefined || agent === false) return null;
  return typeof agent === "string" ? agent : agent.text;
}
