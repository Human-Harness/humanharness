import type { Collection, DataRecord } from "@humanharness/harness-sdk";
import type { DataStore } from "./data";
import { APP_SCOPE } from "./layout";
import { estimateTokens } from "./notes-index";

const CELL_CHARS = 120;

function cell(value: unknown): string {
  const text = value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const flat = text.replace(/\s*\n\s*/g, " ").replace(/\|/g, "\\|");
  return flat.length > CELL_CHARS ? `${flat.slice(0, CELL_CHARS - 1)}…` : flat;
}

const row = (values: unknown[]): string => `| ${values.map(cell).join(" | ")} |`;

/** The records the harness's `order` picks first, else the most recently changed (spec §4.4). */
async function ordered(store: DataStore, name: string, c: Collection, folder: string, records: DataRecord[], action: string | undefined): Promise<DataRecord[]> {
  if (c.context !== false && c.context.order) return c.context.order(records, { ...(action !== undefined ? { action } : {}) });
  const stamps = await store.changedAt(name, folder);
  const when = (r: DataRecord) => stamps[c.key ? String(r[c.key]) : ""] ?? "";
  // A stable sort: records with no stamp keep their key order, after the stamped ones.
  return [...records].sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
}

/**
 * The data part of a new session's first message (spec §4.4): one Markdown table per collection with `context`,
 * cut at its `tokens`, saying how many rows were left out. Empty when no collection has `context` (D2).
 */
export async function buildDataContext(store: DataStore, collections: Record<string, Collection>, scope: string, action: string | undefined): Promise<string> {
  const tables: string[] = [];
  for (const [name, c] of Object.entries(collections)) {
    if (c.context === false || c.agent === "none") continue;
    if (c.scoped && scope === APP_SCOPE) continue;
    const folder = c.scoped ? scope : APP_SCOPE;
    const { records } = await store.readAll(name, folder);
    if (records.length === 0) continue;
    const listed = c.context.fields === "all" ? Object.keys(c.schema.shape) : c.context.fields;
    const fields = c.key ? [c.key, ...listed.filter((f) => f !== c.key)] : listed;
    const head = [`## Data: ${name}`, "", row(fields), `|${fields.map(() => "---").join("|")}|`];
    const lines = [...head];
    const sorted = await ordered(store, name, c, folder, records, action);
    let shown = 0;
    for (const r of sorted) {
      const line = row(fields.map((f) => r[f]));
      if (shown > 0 && estimateTokens([...lines, line].join("\n")) > c.context.tokens) break;
      lines.push(line);
      shown++;
    }
    if (shown < sorted.length) lines.push("", `… ${sorted.length - shown} more in ${name}: use data_query to read them.`);
    tables.push(lines.join("\n"));
  }
  return tables.join("\n\n");
}
