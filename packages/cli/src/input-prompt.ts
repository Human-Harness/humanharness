import type { Writable } from "node:stream";
import { type InputField, type InputSpec, choiceOptions } from "@humanharness/harness-sdk";

/** Asks one question at the prompt and reads one line; null when the input ended. */
export type Ask = (question: string) => Promise<string | null>;

const YES = /^y(es)?$/i;

/**
 * `run`'s `a` (input-blocks spec §8): asks each field of the pending input block, one prompt per field. A choice is
 * picked by its number among the shown options; `pairs` repeat until an empty first cell. Null: the input ended.
 * The main process checks the answer as it does the window's.
 */
export async function promptAnswer(spec: InputSpec, data: unknown, ask: Ask, out: Writable): Promise<Record<string, unknown> | null> {
  if (spec.skippable) {
    const skip = await ask("Skip this question? (y/N) ");
    if (skip === null) return null;
    if (YES.test(skip.trim())) return { skipped: true };
  }
  const value: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const got = await askField(f, data, ask, out);
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

async function askField(f: InputField, data: unknown, ask: Ask, out: Writable): Promise<Got> {
  const label = `${f.label}${f.optional ? " (optional)" : ""}`;
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
      const question = f.kind === "choice" ? `${label} (number): ` : `${label} (numbers, separated by commas): `;
      // Only the listed numbers count: anything else asks again, so no typed digits are ever sent as the answer.
      for (;;) {
        const a = await ask(question);
        if (a === null) return null;
        if (!a.trim()) return f.kind === "multiChoice" && !f.optional ? { value: [] } : {};
        const numbers = a.split(",").map((s) => Number(s.trim()));
        const valid = numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= options.length);
        if (valid && (f.kind === "multiChoice" || numbers.length === 1)) {
          // Each option once, in the options' order.
          const picked = new Set(numbers);
          const picks = options.filter((_, i) => picked.has(i + 1));
          return { value: f.kind === "choice" ? picks[0] : picks };
        }
        out.write(f.kind === "choice" ? `  Pick one number from 1 to ${options.length}.\n` : `  Pick numbers from 1 to ${options.length}.\n`);
      }
    }
    case "pairs": {
      const cols = f.columns ?? [];
      if (cols.length === 0) {
        out.write(`${label}: can't be answered here.\n`);
        return {};
      }
      const rows: Record<string, string>[] = [];
      out.write(`${label}: one row at a time; an empty line ends.\n`);
      for (let n = 1; ; n++) {
        const row: Record<string, string> = {};
        for (const [i, c] of cols.entries()) {
          const a = await ask(`  ${c.label} ${n}: `);
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
