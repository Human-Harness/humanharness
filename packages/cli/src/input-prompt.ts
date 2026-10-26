import type { Writable } from "node:stream";
import { type InputField, type InputSpec, type Language, choiceOptions } from "@humanharness/harness-sdk";

/** Asks one question at the prompt and reads one line; null when the input ended. */
export type Ask = (question: string) => Promise<string | null>;

const YES = /^y(es)?$/i;

/**
 * `run`'s `a` (input-blocks spec §8): asks each field of the pending input block, one prompt per field. A choice is
 * picked by its number among the shown options; `pairs` repeat until an empty first cell. Null: the input ended.
 * The main process checks the answer as it does the window's.
 */
export async function promptAnswer(spec: InputSpec, data: unknown, ask: Ask, out: Writable, language: Language): Promise<Record<string, unknown> | null> {
  if (spec.skippable) {
    const skip = await ask("Skip this question? (y/N) ");
    if (skip === null) return null;
    if (YES.test(skip.trim())) return { skipped: true };
  }
  const value: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const got = await askField(f, data, ask, out, language);
    if (got === null) return null;
    if ("value" in got) value[f.name] = got.value;
  }
  return value;
}

/** A field's answer: `{ value }`, `{}` when an optional field is left out, null when the input ended. */
type Got = { value: unknown } | Record<string, never> | null;

async function text(label: string, f: InputField, ask: Ask): Promise<Got> {
  const a = await ask(`${label}: `);
  if (a === null) return null;
  return a.trim() || !f.optional ? { value: a } : {};
}

async function askField(f: InputField, data: unknown, ask: Ask, out: Writable, language: Language): Promise<Got> {
  const label = `${f.label[language]}${f.optional ? " (optional)" : ""}`;
  switch (f.kind) {
    case null:
      out.write(`${label}: can't be answered here.\n`);
      return {};
    case "boolean": {
      const a = await ask(`${label} (y/n): `);
      return a === null ? null : { value: YES.test(a.trim()) };
    }
    case "number": {
      const a = await ask(`${label}: `);
      if (a === null) return null;
      return a.trim() ? { value: Number(a.trim()) } : {};
    }
    case "choice":
    case "multiChoice": {
      const options = choiceOptions(f, data);
      if (options.length === 0 && f.kind === "choice") return text(label, f, ask);
      options.forEach((o, i) => out.write(`  ${i + 1}. ${o}\n`));
      const a = await ask(f.kind === "choice" ? `${label} (number): ` : `${label} (numbers, separated by commas): `);
      if (a === null) return null;
      const picks = a
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n) && n >= 1 && n <= options.length)
        .map((n) => options[n - 1]);
      if (f.kind === "choice") return picks.length > 0 ? { value: picks[0] } : a.trim() ? { value: a.trim() } : {};
      return picks.length > 0 || !f.optional ? { value: picks } : {};
    }
    case "pairs": {
      const cols = f.columns ?? [];
      const rows: Record<string, string>[] = [];
      out.write(`${label}: one row at a time; an empty line ends.\n`);
      for (let n = 1; ; n++) {
        const row: Record<string, string> = {};
        for (const [i, c] of cols.entries()) {
          const a = await ask(`  ${c.label[language]} ${n}: `);
          if (a === null) return null;
          if (i === 0 && !a.trim()) return rows.length > 0 || !f.optional ? { value: rows } : {};
          row[c.name] = a;
        }
        rows.push(row);
      }
    }
    default:
      return text(label, f, ask);
  }
}
