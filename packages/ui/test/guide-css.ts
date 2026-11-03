import { readFileSync } from "node:fs";
import { resolve } from "node:path";
export const css = readFileSync(resolve(import.meta.dirname, "../src/styles.css"), "utf8");
/** The declarations of the first top-level rule whose selector list contains `sel` exactly. */
export function rule(sel: string): Record<string, string> {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`^[^{}]*(?:^|,\\s*)${esc}\\s*(?:,[^{]*)?\\{([^}]*)\\}`, "m"));
  if (!m) throw new Error(`no rule for ${sel}`);
  return Object.fromEntries(m[1].split(";").map((d) => d.split(":").map((x) => x.trim())).filter(([k, v]) => k && v));
}
