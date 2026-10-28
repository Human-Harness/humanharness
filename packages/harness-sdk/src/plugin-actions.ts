import { jsonSchemaToZod, type PluginManifest } from "./plugin";

type Action = PluginManifest["actions"][number];
export const ACTION_STRING_MAX = 200;
export const ACTION_VARS_MAX_BYTES = 4096;
const VAR = /\{\{([A-Za-z_][A-Za-z0-9_]{0,39})\}\}/g;
/**
 * What a filled value loses: controls (tab and newline stay), bidi marks, overrides and isolates, zero-width characters
 * and line separators, so the prompt the prepared card shows is the prompt the agent reads (P6, B12).
 */
const HIDDEN = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g;

const longString = (v: unknown): boolean =>
  typeof v === "string" ? v.length > ACTION_STRING_MAX : Array.isArray(v) ? v.some(longString) : typeof v === "object" && v !== null ? Object.values(v).some(longString) : false;

/** The action's vars, validated (P6): an object within 4 KB of JSON, every string ≤ 200 (deep), then the action's own schema. */
export function checkActionVars(action: Pick<Action, "vars">, vars: unknown): { ok: true; vars: Record<string, unknown> } | { ok: false; message: string } {
  if (typeof vars !== "object" || vars === null || Array.isArray(vars)) return { ok: false, message: "Variables are an object" };
  let json: string | undefined;
  try {
    json = JSON.stringify(vars);
  } catch {
    json = undefined;
  }
  if (json === undefined || new TextEncoder().encode(json).length > ACTION_VARS_MAX_BYTES) return { ok: false, message: "Variables are too large" };
  if (longString(vars)) return { ok: false, message: `A text variable is longer than ${ACTION_STRING_MAX} characters` };
  let schema;
  try {
    // `additionalProperties: false` builds a strict object (part 1), so an undeclared var is refused.
    schema = jsonSchemaToZod(action.vars);
  } catch {
    return { ok: false, message: "The action's variables schema is not supported" };
  }
  const r = schema.safeParse(vars);
  if (!r.success) return { ok: false, message: r.error.issues[0]?.message ?? "Invalid variables" };
  return { ok: true, vars: r.data as Record<string, unknown> };
}

/** `{{name}}` placeholders of a prompt, once each, in order (no secrets, no spaces). */
export function promptPlaceholders(prompt: string): string[] {
  return [...new Set([...prompt.matchAll(VAR)].map((m) => m[1]))];
}

/** The template filled literally in one pass (P6): a value is never expanded again; a placeholder with no value is refused. */
export function fillActionPrompt(prompt: string, vars: Record<string, unknown>): { ok: true; text: string } | { ok: false; message: string } {
  const missing = promptPlaceholders(prompt).find((n) => !Object.hasOwn(vars, n) || vars[n] === undefined);
  if (missing) return { ok: false, message: `No value for "${missing}"` };
  const text = prompt.replace(VAR, (_m, n: string) => {
    const v = vars[n];
    return (typeof v === "string" ? v : JSON.stringify(v)).replace(HIDDEN, "");
  });
  return { ok: true, text };
}

const TITLE_VAR_MAX = 40;

/** "<plugin> · <label>[ <first required short string var>]" (Decision 10). */
export function preparedTitle(pluginName: string, action: Pick<Action, "label" | "vars">, vars: Record<string, unknown>): string {
  const props = (typeof action.vars.properties === "object" && action.vars.properties !== null ? action.vars.properties : {}) as Record<string, { type?: unknown }>;
  const required = Array.isArray(action.vars.required) ? (action.vars.required as string[]) : [];
  const name = Object.keys(props).find((k) => required.includes(k) && props[k].type === "string" && Object.hasOwn(vars, k) && typeof vars[k] === "string" && (vars[k] as string).length <= TITLE_VAR_MAX);
  const value = name ? (vars[name] as string).replace(HIDDEN, "").trim() : "";
  return `${pluginName} · ${action.label}${value ? ` ${value}` : ""}`;
}
