import { z } from "zod";
import type { Block, InputFieldUi, InputKind } from "./block";
import type { LocalizedText } from "./index";

/** Strings up to this many characters get one line; longer or unbounded ones a growing textarea (spec §5). */
export const SHORT_TEXT_MAX = 200;

/** One field of an input block, as plain data: what the window's form and the terminal draw. */
export interface InputField {
  name: string;
  /** null: the core form can't draw this field (a harness component must). */
  kind: InputKind | null;
  label: LocalizedText;
  optional: boolean;
  /** Text: length bounds. Number: value bounds. */
  min?: number;
  max?: number;
  /** An enum `choice` and `multiChoice`: the options. */
  options?: string[];
  /** A `choice` on a string field: the shown data's field that holds the options. */
  optionsFrom?: string;
  /** `pairs`: the two inner fields, in order, with their labels. */
  columns?: { name: string; label: LocalizedText }[];
}

/** What the window needs to draw an input block's core form; sent with the app state. */
export interface InputSpec {
  fields: InputField[];
  submitLabel?: LocalizedText;
  skippable?: boolean;
}

function humanize(name: string): string {
  const words = name.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : name;
}
const plainLabel = (name: string): LocalizedText => ({ es: humanize(name), en: humanize(name) });

/** The type under `.optional()` and `.default()`, and whether the field may be left out. */
function unwrap(type: z.ZodType): { inner: z.ZodType; optional: boolean } {
  let inner = type;
  let optional = false;
  while (inner instanceof z.ZodOptional || inner instanceof z.ZodDefault) {
    optional = true;
    inner = inner.unwrap() as z.ZodType;
  }
  return { inner, optional };
}

const isStringArray = (type: z.ZodType | undefined): boolean => {
  if (!type) return false;
  const { inner } = unwrap(type);
  return inner instanceof z.ZodArray && unwrap(inner.element as z.ZodType).inner instanceof z.ZodString;
};

const bound = (key: "min" | "max", v: number | null | undefined): Partial<Record<"min" | "max", number>> =>
  typeof v === "number" && Number.isFinite(v) ? { [key]: v } : {};

function fieldOf(name: string, type: z.ZodType, ui: InputFieldUi | undefined, shown: Record<string, z.ZodType>): InputField {
  const { inner, optional } = unwrap(type);
  const base = { name, label: ui?.label ?? plainLabel(name), optional };
  if (inner instanceof z.ZodString) {
    // By convention a `choice` field takes the shown data's `options` (the spec's own example).
    const from = ui?.optionsFrom ?? (name === "choice" && isStringArray(shown.options) ? "options" : undefined);
    if (from && (ui?.kind === undefined || ui.kind === "choice")) return { ...base, kind: "choice", optionsFrom: from };
    const long = ui?.kind === "longText" || (ui?.kind !== "text" && (inner.maxLength === null || inner.maxLength > SHORT_TEXT_MAX));
    return { ...base, kind: long ? "longText" : "text", ...bound("min", inner.minLength), ...bound("max", inner.maxLength) };
  }
  if (inner instanceof z.ZodEnum) return { ...base, kind: "choice", options: inner.options.map(String) };
  if (inner instanceof z.ZodNumber) return { ...base, kind: "number", ...bound("min", inner.minValue), ...bound("max", inner.maxValue) };
  if (inner instanceof z.ZodBoolean) return { ...base, kind: "boolean" };
  if (inner instanceof z.ZodArray) {
    const element = unwrap(inner.element as z.ZodType).inner;
    if (element instanceof z.ZodEnum) return { ...base, kind: "multiChoice", options: element.options.map(String) };
    if (element instanceof z.ZodObject) {
      const columns = Object.entries(element.shape as Record<string, z.ZodType>);
      if (columns.length === 2 && columns.every(([, t]) => t instanceof z.ZodString)) {
        return { ...base, kind: "pairs", columns: columns.map(([c]) => ({ name: c, label: ui?.columns?.[c] ?? plainLabel(c) })) };
      }
    }
  }
  return { ...base, kind: null };
}

/** The fields of a block's input, in order ([] for a block with no input). */
export function inputFields(block: Pick<Block, "input" | "inputUi" | "schema">): InputField[] {
  if (!block.input) return [];
  const shown = block.schema.shape as Record<string, z.ZodType>;
  const ui = (block.inputUi ?? {}) as Record<string, InputFieldUi | undefined>;
  return Object.entries(block.input.shape as Record<string, z.ZodType>).map(([name, type]) => fieldOf(name, type, ui[name], shown));
}

export function inputSpec(block: Block): InputSpec {
  return {
    fields: inputFields(block),
    ...(block.submitLabel ? { submitLabel: block.submitLabel } : {}),
    ...(block.skippable ? { skippable: true } : {}),
  };
}

/** The specs of the blocks that declare an input, by name ({} when none: spec D0). */
export function inputSpecs(blocks: Record<string, Block>): Record<string, InputSpec> {
  return Object.fromEntries(Object.entries(blocks).flatMap(([name, b]) => (b.input ? [[name, inputSpec(b)]] : [])));
}

/** A choice's options: an enum's own, or the strings in the shown data's `optionsFrom` field. */
export function choiceOptions(field: InputField, data: unknown): string[] {
  if (field.options) return field.options;
  if (!field.optionsFrom || typeof data !== "object" || data === null) return [];
  const raw = (data as Record<string, unknown>)[field.optionsFrom];
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === "string" && o.length > 0) : [];
}
