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
/** Each value of a length list (`padding: calc(var(--hh-s-3) / 2) var(--hh-s-3)`) as pixels, with the `--hh-s-*` / `--hh-h-*` tokens and simple calc resolved. */
export function lengths(value: string | undefined): number[] {
  const root = rule(":root");
  const resolved = (value ?? "").replace(/var\((--[\w-]+)\)/g, (_, name: string) => String(parseFloat(root[name])));
  const out: number[] = [];
  for (const m of resolved.matchAll(/calc\(([^()]*)\)|(-?[\d.]+)(?:px)?/g)) {
    if (m[1] !== undefined) out.push(Function(`"use strict"; return (${m[1].replace(/px/g, "")});`)() as number);
    else out.push(parseFloat(m[2]));
  }
  return out;
}
