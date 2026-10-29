import { type Collection, type DataRecord, HIDDEN_CHARS } from "@humanharness/harness-sdk";
import type { DataStore } from "./data";
import { APP_SCOPE } from "./layout";
import { estimateTokens } from "./notes-index";

const CELL_CHARS = 120;

const HIDDEN = new RegExp(HIDDEN_CHARS.source, "gu");
/** Outside text (a plugin's table) on one plain line: controls and line separators become spaces, the rest of HIDDEN_CHARS goes. */
const plain = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(HIDDEN, "");

function cell(value: unknown, max: number, outside: boolean): string {
  const raw = value === undefined || value === null ? "" : typeof value === "string" ? value : JSON.stringify(value);
  const text = outside ? plain(raw) : raw;
  const flat = text.replace(/\s*[\r\n]+\s*/g, " ");
  const cut = flat.length > max ? `${flat.slice(0, Math.max(max - 1, 0))}…` : flat;
  return cut.replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
}

const row = (values: unknown[], outside: boolean, max = CELL_CHARS): string => `| ${values.map((v) => cell(v, max, outside)).join(" | ")} |`;

const footer = (left: number, name: string): string => `… ${left} more in ${name}: use data_query to read them.`;

/** The records the harness's `order` picks first, else the most recently changed (spec §4.4). */
async function ordered(store: DataStore, name: string, c: Collection, folder: string, records: DataRecord[], action: string | undefined): Promise<DataRecord[]> {
  if (c.context !== false && c.context.order) {
    try {
      const result = c.context.order(records, { ...(action !== undefined ? { action } : {}) });
      if (Array.isArray(result)) return result;
      console.error(`The order of "${name}" did not return a list; using the most recently changed`);
    } catch (err) {
      console.error(`The order of "${name}" failed; using the most recently changed`, err);
    }
  }
  const stamps = await store.changedAt(name, folder);
  const when = (r: DataRecord) => stamps[c.key ? String(r[c.key]) : ""] ?? "";
  // A stable sort: records with no stamp keep their file order, after the stamped ones.
  return [...records].sort((a, b) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0));
}

/** One collection's table in a first message (context-panel spec §3.1 `data`): its name (the label, when given), the rows it shows, its text. */
export interface DataContextPart {
  collection: string;
  rows: number;
  text: string;
}

/**
 * The data part of a new session's first message (spec §4.4): one Markdown table per collection with `context`,
 * cut at its `tokens` (the "more" line included), saying how many rows were left out. Empty when no collection has `context` (D2).
 * `opts.label` names each collection as the agent knows it (a plugin's `<id>.<collection>`); absent: its own name.
 */
export async function buildDataContextParts(
  store: DataStore,
  collections: Record<string, Collection>,
  scope: string,
  action: string | undefined,
  opts: { label?: (name: string) => string } = {},
): Promise<DataContextPart[]> {
  const parts: DataContextPart[] = [];
  for (const [name, c] of Object.entries(collections)) {
    const title = opts.label ? opts.label(name) : name;
    // A labelled table is a plugin's: its names and values come from outside, so they get the stricter cleanup.
    const outside = opts.label !== undefined;
    if (c.context === false || c.agent === "none") continue;
    if (c.scoped && scope === APP_SCOPE) continue;
    const folder = c.scoped ? scope : APP_SCOPE;
    const { records } = await store.readAll(name, folder);
    if (records.length === 0) continue;
    const budget = c.context.tokens;
    const listed = c.context.fields === "all" ? Object.keys(c.schema.shape) : c.context.fields;
    const fields = c.key ? [c.key, ...listed.filter((f) => f !== c.key)] : listed;
    const lines = [`## Data: ${title}`, "", row(fields, outside), `|${fields.map(() => "---").join("|")}|`];
    const sorted = await ordered(store, name, c, folder, records, action);
    let shown = 0;
    for (const r of sorted) {
      const left = records.length - shown - 1;
      const tail = left > 0 ? ["", footer(left, title)] : [];
      const fits = (line: string) => estimateTokens([...lines, line, ...tail].join("\n")) <= budget;
      let line = row(fields.map((f) => r[f]), outside);
      if (shown === 0) {
        // The first row always shows: shorten its cells until the table fits.
        for (let max = CELL_CHARS; !fits(line) && max > 1; ) {
          max = Math.floor(max / 2);
          line = row(fields.map((f) => r[f]), outside, max);
        }
      } else if (!fits(line)) break;
      lines.push(line);
      shown++;
    }
    if (shown < records.length) lines.push("", footer(records.length - shown, title));
    parts.push({ collection: title, rows: shown, text: lines.join("\n") });
  }
  return parts;
}

/** The tables joined: exactly the text the first message carried before (D0). */
export async function buildDataContext(
  store: DataStore,
  collections: Record<string, Collection>,
  scope: string,
  action: string | undefined,
  opts: { label?: (name: string) => string } = {},
): Promise<string> {
  return (await buildDataContextParts(store, collections, scope, action, opts)).map((p) => p.text).join("\n\n");
}
