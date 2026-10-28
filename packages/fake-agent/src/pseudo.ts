/** The batch a translation prompt carries between `<batch>` and `</batch>` (task-prompts `translatePrompt`). */
interface Batch {
  forms?: string[];
  strings?: Record<string, string | Record<string, string>>;
}

export type PseudoStrings = Record<string, string | Record<string, string>>;

/**
 * The fake engine's answer to a translation turn (spec §9): `<prefix> <English>`, placeholders and
 * tags kept, and each plural form the batch asks for. `breakKeys` drop their placeholders, so the
 * app's check refuses them.
 */
export function pseudoTranslate(prompt: string, prefix = "[xx]", breakKeys: readonly string[] = []): PseudoStrings {
  const m = /<batch>\s*([\s\S]*?)\s*<\/batch>/.exec(prompt);
  if (!m) return {};
  let batch: Batch;
  try {
    batch = JSON.parse(m[1]) as Batch;
  } catch {
    return {};
  }
  const forms = Array.isArray(batch.forms) ? batch.forms : ["other"];
  const one = (key: string, text: string) => {
    const t = `${prefix} ${text}`;
    return breakKeys.includes(key) ? t.replace(/\s*\{\{[^{}]*\}\}/g, "") : t;
  };
  const out: PseudoStrings = {};
  for (const [key, en] of Object.entries(batch.strings ?? {})) {
    if (typeof en === "string") out[key] = one(key, en);
    else if (en && typeof en === "object") out[key] = Object.fromEntries(forms.map((f) => [f, one(key, en[f] ?? en.other ?? Object.values(en)[0] ?? "")]));
  }
  return out;
}
