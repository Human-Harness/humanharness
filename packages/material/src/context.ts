import type { GroundingMode } from "@humanharness/harness-sdk";
import { estimateTokens } from "@humanharness/workspace";
import type { IndexRow } from "./store";

/** The grounding rule of each mode (§9 Ground), in the task's first message: the mode is per scope. */
export const GROUNDING_RULES: Record<GroundingMode, string> = {
  strict: "Answer from the material only. When it doesn't cover something, say so; don't fill the gap from your own knowledge.",
  mixed: "Prefer the material. You may add your own knowledge; say when you do.",
};

/** The scope's mode (§9 Ground): the person's choice only when the harness lets them change it; else the harness's. */
export const groundingMode = (chosen: GroundingMode | null, rule: { default: GroundingMode; personCanChange: boolean }): GroundingMode =>
  rule.personCanChange && chosen ? chosen : rule.default;

const cell = (s: string) => s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();

/**
 * The first message's `## Material` (§9 Load): the scope's rule, how to fetch, the sheet, then index rows until
 * `budgetTokens` (the table only; the first row always shows, even over the budget); the rest is found with
 * `material_search`. Empty when nothing is usable.
 */
export function materialSection(o: { mode: GroundingMode; sheet: string; rows: IndexRow[]; budgetTokens: number }): string {
  if (o.rows.length === 0) return "";
  const head = [
    "## Material",
    "",
    `The person's own material for this scope. ${GROUNDING_RULES[o.mode]}`,
    "Fetch a fragment with `material_read` (its id), find more with `material_search`. Cite what you use as [[frag:<id>]].",
  ].join("\n");
  const table = ["| id | where | path | kind | summary |", "|---|---|---|---|---|"];
  let used = estimateTokens(table.join("\n"));
  let shown = 0;
  for (const r of o.rows) {
    const line = `| ${r.id} | ${cell(r.where)} | ${cell(r.path)} | ${cell(r.kind)} | ${cell(r.summary)} |`;
    const cost = estimateTokens(line);
    if (shown > 0 && used + cost > o.budgetTokens) break;
    table.push(line);
    used += cost;
    shown++;
  }
  const more = o.rows.length - shown;
  return [head, o.sheet.trim(), table.join("\n"), more > 0 ? `${more} more fragments: find them with \`material_search\`.` : ""].filter(Boolean).join("\n\n");
}
