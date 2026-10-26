import type { InputField, InputSpec } from "./client";

/** The window's languages. The UI never imports the SDK at runtime, so these helpers mirror its small rules. */

/** A choice's options: the enum's own, or the strings of the shown data's `optionsFrom` field (the SDK's `choiceOptions`). */
export function optionsOf(field: InputField, data: unknown): string[] {
  if (field.options) return field.options;
  if (!field.optionsFrom || typeof data !== "object" || data === null) return [];
  const raw = (data as Record<string, unknown>)[field.optionsFrom];
  return Array.isArray(raw) ? raw.filter((o): o is string => typeof o === "string" && o.length > 0) : [];
}

export const isSkipped = (v: Record<string, unknown>): boolean => Object.keys(v).length === 1 && v.skipped === true;

/** What the form holds while the person writes: by field name. */
export type Draft = Record<string, unknown>;
type Row = Record<string, string>;

export function emptyDraft(spec: InputSpec): Draft {
  const draft: Draft = {};
  for (const f of spec.fields) {
    if (f.kind === "boolean") draft[f.name] = false;
    else if (f.kind === "multiChoice") draft[f.name] = [];
    else if (f.kind === "pairs") draft[f.name] = [{}];
    else if (f.kind !== null) draft[f.name] = "";
  }
  return draft;
}

/** The answer the form sends: empty optional fields are left out, and pair rows with both cells empty dropped. */
export function draftValue(spec: InputSpec, draft: Draft): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of spec.fields) {
    const v = draft[f.name];
    if (f.kind === "text" || f.kind === "longText" || f.kind === "choice") {
      const s = typeof v === "string" ? v : "";
      if (s.trim() || !f.optional) out[f.name] = s;
    } else if (f.kind === "number") {
      const s = typeof v === "string" ? v.trim() : "";
      if (s) out[f.name] = Number(s);
    } else if (f.kind === "boolean") out[f.name] = v === true;
    else if (f.kind === "multiChoice") {
      const picked = Array.isArray(v) ? v : [];
      if (picked.length > 0 || !f.optional) out[f.name] = picked;
    } else if (f.kind === "pairs") {
      const cols = f.columns ?? [];
      const rows = (Array.isArray(v) ? (v as Row[]) : [])
        .filter((r) => cols.some((c) => (r[c.name] ?? "").trim()))
        .map((r) => Object.fromEntries(cols.map((c) => [c.name, r[c.name] ?? ""])));
      if (rows.length > 0 || !f.optional) out[f.name] = rows;
    }
  }
  return out;
}

/** One row per answered field, for the read-only view (the SDK's `readableAnswer`, per field). */
export function answerRows(spec: InputSpec, value: Record<string, unknown>, yesNo: [string, string]): { label: string; text: string }[] {
  return spec.fields.flatMap((f) => {
    const v = value[f.name];
    if (v === undefined || v === null) return [];
    let text: string;
    if (f.kind === "boolean") text = v === true ? yesNo[0] : yesNo[1];
    else if (f.kind === "multiChoice" && Array.isArray(v)) text = v.map(String).join(", ");
    else if (f.kind === "pairs" && Array.isArray(v)) {
      text = v.map((row) => (f.columns ?? []).map((c) => String((row as Record<string, unknown> | null)?.[c.name] ?? "")).join(" → ")).join("; ");
    } else text = typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v);
    return text.trim() ? [{ label: f.label, text }] : [];
  });
}
