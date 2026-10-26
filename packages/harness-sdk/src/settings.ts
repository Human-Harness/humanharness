import { z } from "zod";
import { type Collection, collectionSchema } from "./data";
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

/** One setting's declaration (spec §3). The harness's `settings.fields` and a mode's `settings` share it. */
export const settingFieldSchema = z.object({
  /** A zod type: z.enum (segmented, select), z.boolean (toggle), z.number (number) or z.string (text). */
  schema: z.custom<z.ZodType>((s) => s instanceof z.ZodType, { message: "Expected a zod schema" }),
  /** The value until the person changes it; it must match `schema`. */
  // Optional here only so a missing default gets the refine's own message.
  default: z.unknown().optional(),
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
    fields: z.record(z.string().regex(SETTING_NAME), settingFieldSchema),
  })
  .superRefine((s, ctx) => {
    const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
    const sections = new Set<string>();
    for (const [i, section] of s.sections.entries()) {
      if (sections.has(section.id)) issue(["sections", i, "id"], `Section "${section.id}" is declared twice`);
      sections.add(section.id);
    }
    // "Declare at least one setting" is the manifest's: a mode's settings count too (task-modes spec §3).
    checkSettingFields(s.fields, sections, (path, message) => issue(["fields", ...path], message));
  });

export type HarnessSettings = z.output<typeof settingsSchema>;
export type HarnessSettingsInput = z.input<typeof settingsSchema>;
export type SettingField = HarnessSettings["fields"][string];

/** What mode settings need of the manifest's modes: their label and settings (task-modes spec §3). */
export type ModesWithSettings = Record<string, { label: string; settings?: Record<string, SettingField> }>;

/** A mode setting's key in values, views and `client.settings.set` (harness-settings spec §6). */
export const modeSettingKey = (mode: string, field: string): string => `${mode}.${field}`;

/** Every mode setting, in manifest order: its key, mode, field name and declaration. */
export function modeSettingFields(modes: ModesWithSettings | undefined): [key: string, mode: string, name: string, field: SettingField][] {
  return Object.entries(modes ?? {}).flatMap(([mode, m]) =>
    Object.entries(m.settings ?? {}).map(([name, f]): [string, string, string, SettingField] => [modeSettingKey(mode, name), mode, name, f]),
  );
}

/** One setting found by its key: a harness field (`tone`) or a mode's (`socratic.questions`). */
export interface SettingRef {
  key: string;
  name: string;
  /** The mode a mode setting belongs to. */
  mode?: string;
  field: SettingField;
}

/** The setting `key` names, or null. Own keys only: `constructor` or `socratic.constructor` find nothing. */
export function settingRef(settings: HarnessSettings, modes: ModesWithSettings | undefined, key: string): SettingRef | null {
  const dot = key.indexOf(".");
  if (dot < 0) return Object.hasOwn(settings.fields, key) ? { key, name: key, field: settings.fields[key] } : null;
  const mode = key.slice(0, dot);
  const name = key.slice(dot + 1);
  const own = modes && Object.hasOwn(modes, mode) ? modes[mode].settings : undefined;
  return own && Object.hasOwn(own, name) ? { key, name, mode, field: own[name] } : null;
}

/**
 * The checks every declared setting gets (spec §3 `check`), for the harness's fields and a mode's alike. `sections`
 * is the declared section ids, or null for a mode's settings, which are grouped by their mode. Paths start at the
 * field's name.
 */
export function checkSettingFields(
  fields: Record<string, z.output<typeof settingFieldSchema>>,
  sections: ReadonlySet<string> | null,
  issue: (path: (string | number)[], message: string) => void,
): void {
  for (const [name, f] of Object.entries(fields)) {
    const at = (...rest: (string | number)[]) => [name, ...rest];
    if (RESERVED_SETTINGS.includes(name)) issue(at(), `"${name}" is reserved for mode settings`);
    if (f.section !== undefined) {
      if (sections === null) issue(at("section"), "Mode settings are grouped by their mode: drop section");
      else if (!sections.has(f.section)) issue(at("section"), `Section "${f.section}" is not declared in sections`);
    }
    if (!(f.schema instanceof z.ZodType)) continue;
    const inferred = inferSetting(f.schema);
    if (!CONTROL_KINDS[f.control].includes(inferred.kind ?? "")) {
      issue(at("control"), `The ${f.control} control needs ${CONTROL_TYPES[f.control]} schema`);
      continue;
    }
    // A schema that takes undefined (.default(), .optional()) would let the store fill its own default, not `default`.
    if (f.schema.safeParse(undefined).success) issue(at("schema"), "Give the default in default, not on the schema (no .default() or .optional())");
    else if (f.default === undefined) issue(at("default"), "Give a default value");
    else if (!f.schema.safeParse(f.default).success) issue(at("default"), "The default does not match the schema");
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
    let fillsValue = false;
    for (const m of template.matchAll(SETTING_PLACEHOLDER)) {
      if (m[1] !== "value" && m[1] !== "value:label") issue(at("agent"), `Unknown placeholder {{${m[1]}}}: use {{value}} or {{value:label}}`);
      else if (m[1] === "value:label" && !LABELLED.includes(f.control)) issue(at("agent"), "{{value:label}} needs a segmented, select or toggle control: use {{value}}");
      else fillsValue = true;
    }
    // An uncapped text would let a value of any length into AGENTS.md or a mode's brief.
    if (fillsValue && f.control === "text" && inferred.max === undefined) issue(at("schema"), "The agent reads this text: cap its length with .max(n)");
  }
}

/** A field's sentence template, or null for a UI-only field. */
export function agentText(agent: SettingField["agent"]): string | null {
  if (agent === undefined || agent === false) return null;
  return typeof agent === "string" ? agent : agent.text;
}

/** The reserved data collection that holds the person's settings (spec D2). */
export const SETTINGS_COLLECTION = "settings";
/** `check` warns when the settings' section of AGENTS.md is longer than this (spec §5 "Measuring"). */
export const SETTINGS_TOKENS_WARN = 400;

/**
 * The `settings` collection: app-wide, one record, hidden from the agent (it gets sentences: D3). Its fields are
 * optional: the record holds only what the person changed, and `settingsValues` fills the defaults on read. Mode
 * settings, when a mode has any, sit under `modes.<mode>` (spec §6).
 */
export function settingsCollection(settings: HarnessSettings, modes?: ModesWithSettings): Collection {
  const optional = (fields: Record<string, SettingField>) => Object.fromEntries(Object.entries(fields).map(([name, f]) => [name, f.schema.optional()]));
  const shape: Record<string, z.ZodType> = optional(settings.fields);
  const own = Object.entries(modes ?? {}).filter(([, m]) => Object.keys(m.settings ?? {}).length > 0);
  if (own.length > 0) shape.modes = z.object(Object.fromEntries(own.map(([id, m]) => [id, z.object(optional(m.settings!)).optional()]))).optional();
  return collectionSchema.parse({ scoped: false, single: true, schema: z.object(shape), agent: "none" });
}

/** Every collection the data store keeps: the harness's, plus `settings` when it declares settings (D0: `data` itself). */
export function dataCollections(h: { data: Record<string, Collection>; settings?: HarnessSettings; modes?: ModesWithSettings }): Record<string, Collection> {
  return h.settings ? { ...h.data, [SETTINGS_COLLECTION]: settingsCollection(h.settings, h.modes) } : h.data;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Two setting values are the same: they are plain JSON values. */
export const sameSetting = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A field's value from `record`: the stored one when it is valid, else the default (a hand edit falls back field by field). */
function valueIn(record: Record<string, unknown>, name: string, f: SettingField): unknown {
  if (Object.hasOwn(record, name)) {
    const parsed = f.schema.safeParse(record[name]);
    if (parsed.success && parsed.data !== undefined) return parsed.data;
  }
  return structuredClone(f.default);
}

/** Every field's value, by key; mode settings under `<mode>.<field>` when `modes` is given (spec §6). */
export function settingsValues(settings: HarnessSettings, stored: unknown, modes?: ModesWithSettings): Record<string, unknown> {
  const record = isRecord(stored) ? stored : {};
  const values: Record<string, unknown> = Object.fromEntries(Object.entries(settings.fields).map(([name, f]) => [name, valueIn(record, name, f)]));
  const byMode = Object.hasOwn(record, "modes") && isRecord(record.modes) ? record.modes : {};
  for (const [key, mode, name, f] of modeSettingFields(modes)) {
    const own = Object.hasOwn(byMode, mode) && isRecord(byMode[mode]) ? byMode[mode] : {};
    values[key] = valueIn(own, name, f);
  }
  return values;
}

/**
 * The stored record with `ref` set to `value`: a value back at its default is removed, and so is a mode's object
 * (and `modes`) left empty. Only what the person changed is stored (spec D2).
 */
export function withSetting(stored: unknown, ref: SettingRef, value: unknown): Record<string, unknown> {
  const record: Record<string, unknown> = isRecord(stored) ? { ...stored } : {};
  const set = (into: Record<string, unknown>) => {
    if (sameSetting(value, ref.field.default)) delete into[ref.name];
    else into[ref.name] = value;
  };
  if (ref.mode === undefined) {
    set(record);
    return record;
  }
  const modes: Record<string, unknown> = isRecord(record.modes) ? { ...record.modes } : {};
  const own: Record<string, unknown> = Object.hasOwn(modes, ref.mode) && isRecord(modes[ref.mode]) ? { ...(modes[ref.mode] as Record<string, unknown>) } : {};
  set(own);
  if (Object.keys(own).length > 0) modes[ref.mode] = own;
  else delete modes[ref.mode];
  if (Object.keys(modes).length > 0) record.modes = modes;
  else delete record.modes;
  return record;
}

const shown = (v: unknown): string => (typeof v === "boolean" ? (v ? "on" : "off") : typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v));

function labelOf(f: SettingField, value: unknown): string {
  const key = String(value);
  return f.options && Object.hasOwn(f.options, key) ? f.options[key] : shown(value);
}

/**
 * The agent's sentence for one field (spec §5), or null: a UI-only field, or an `onlyWhenChanged` one at its default
 * (unless `all`). Whitespace folds to single spaces: one sentence is one line of AGENTS.md.
 */
export function settingSentence(f: SettingField, value: unknown, opts: { all?: boolean } = {}): string | null {
  const template = agentText(f.agent);
  if (template === null) return null;
  const onlyWhenChanged = typeof f.agent === "object" && f.agent.onlyWhenChanged === true;
  if (onlyWhenChanged && !opts.all && sameSetting(value, f.default)) return null;
  const filled = template.replace(SETTING_PLACEHOLDER, (_m, p: string) => (p === "value:label" ? labelOf(f, value) : shown(value)));
  return filled.replace(/\s+/g, " ").trim() || null;
}

/** The sentences for AGENTS.md, in manifest order. */
export function settingsSentences(settings: HarnessSettings, values: Record<string, unknown>, opts: { all?: boolean } = {}): string[] {
  return Object.entries(settings.fields).flatMap(([name, f]) => {
    const sentence = settingSentence(f, Object.hasOwn(values, name) ? values[name] : f.default, opts);
    return sentence ? [sentence] : [];
  });
}

/** A mode's sentences, appended to its brief when it starts (spec §6): never part of AGENTS.md. */
export function modeSentences(modes: ModesWithSettings | undefined, mode: string, values: Record<string, unknown>): string[] {
  const own = modes && Object.hasOwn(modes, mode) ? (modes[mode].settings ?? {}) : {};
  return Object.entries(own).flatMap(([name, f]) => {
    const key = modeSettingKey(mode, name);
    const sentence = settingSentence(f, Object.hasOwn(values, key) ? values[key] : f.default);
    return sentence ? [sentence] : [];
  });
}

/** The fields the agent reads (they have a sentence): their changes wait for the next task (D4). */
export function agentSettings(settings: HarnessSettings): string[] {
  return Object.entries(settings.fields)
    .filter(([, f]) => agentText(f.agent) !== null)
    .map(([name]) => name);
}

/** One field as the window draws it: plain data, sent with the app state. */
export interface SettingFieldView {
  name: string;
  control: SettingControl;
  label: string;
  help?: string;
  unit?: string;
  section?: string;
  /** A mode setting: the mode it belongs to (its `name` is `<mode>.<field>`). */
  mode?: string;
  advanced?: true;
  default: unknown;
  /** segmented and select: the values in order, with their labels. */
  options?: { value: string; label: string }[];
  /** number: value bounds. text: length bounds. */
  min?: number;
  max?: number;
  /** The agent reads it: a change waits for the next task. */
  agent?: true;
}

/** What the harness's Settings tab draws (spec §4). */
export interface SettingsView {
  tab: string;
  sections: { id: string; label: string }[];
  fields: SettingFieldView[];
}

function fieldView(name: string, f: SettingField, extra: Pick<SettingFieldView, "section" | "mode"> = {}): SettingFieldView {
  const inferred = inferSetting(f.schema);
  const choice = f.control === "segmented" || f.control === "select";
  const section = extra.section ?? f.section;
  return {
    name,
    control: f.control,
    label: f.label,
    ...(f.help ? { help: f.help } : {}),
    ...(f.unit ? { unit: f.unit } : {}),
    ...(section ? { section } : {}),
    ...(extra.mode ? { mode: extra.mode } : {}),
    ...(f.advanced ? { advanced: true as const } : {}),
    default: structuredClone(f.default),
    ...(choice ? { options: (inferred.options ?? []).map((value) => ({ value, label: labelOf(f, value) })) } : {}),
    ...(inferred.min !== undefined ? { min: inferred.min } : {}),
    ...(inferred.max !== undefined ? { max: inferred.max } : {}),
    ...(agentText(f.agent) !== null ? { agent: true as const } : {}),
  };
}

/** The tab's data: the harness's fields, then one section per mode with settings (`mode:<id>`, spec §6). */
export function settingsView(settings: HarnessSettings, modes?: ModesWithSettings): SettingsView {
  const own = Object.entries(modes ?? {}).filter(([, m]) => Object.keys(m.settings ?? {}).length > 0);
  return {
    tab: settings.tab,
    sections: [...settings.sections.map((s) => ({ id: s.id, label: s.label })), ...own.map(([id, m]) => ({ id: `mode:${id}`, label: m.label }))],
    fields: [
      ...Object.entries(settings.fields).map(([name, f]) => fieldView(name, f)),
      ...modeSettingFields(modes).map(([key, mode, , f]) => fieldView(key, f, { section: `mode:${mode}`, mode })),
    ],
  };
}
