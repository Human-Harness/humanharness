import ExcelJS from "exceljs";
import { MaterialRefused } from "../blocks";
import { SHEET_MAX_CELLS, SHEET_MAX_COLUMNS, SHEET_MAX_ROWS } from "../constants";
import type { SheetRows } from "../types";
import { decodeText } from "./text";
import { attr, findNode, kids, odfText, tagOf, zipXml } from "./word";
import { checkZip } from "./zip";

const cellMd = (v: string) => v.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
const colName = (n: number): string => (n <= 0 ? "" : colName(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)));
/** The last column a spreadsheet can have (XFD). */
const LAST_COLUMN = 16_384;

/** One row's non-empty cells as `[column, text]` (columns from 1), and its real row number in the sheet. */
type SparseRow = { n: number; cells: [number, string][] };

/**
 * What one file may still read (non-empty cells and rows) and write (rows × kept columns), across its sheets. A file
 * can claim far more than it holds (a cell in column XFD, a row repeated a million times): past the budget the rest
 * of the file is cut, and the sheet says so.
 */
class Budget {
  read = SHEET_MAX_CELLS;
  rows = SHEET_MAX_ROWS;
  written = SHEET_MAX_CELLS;
  /** Takes a row of `cells` non-empty cells; false when the file has no room left. */
  take(cells: number): boolean {
    if (this.rows < 1 || this.read < cells) return false;
    this.rows--;
    this.read -= cells;
    return true;
  }
}

/**
 * Rows into one sheet: the first row is the header; columns empty across the whole sheet are dropped (§3); locations
 * keep the real row and column names (`Data!B7:F7`).
 */
function buildSheet(name: string, all: SparseRow[], budget: Budget, cutWhileReading: boolean): SheetRows | null {
  const used = new Set<number>();
  for (const r of all) for (const [c] of r.cells) used.add(c);
  let cols = [...used].sort((a, b) => a - b);
  let cut = cutWhileReading;
  if (cols.length > SHEET_MAX_COLUMNS) {
    cols = cols.slice(0, SHEET_MAX_COLUMNS);
    cut = true;
  }
  const width = cols.length;
  if (width === 0) return null;
  const at = new Map(cols.map((c, i) => [c, i]));
  const dense = (r: SparseRow): string[] | null => {
    const out: string[] = Array(width).fill("");
    let any = false;
    for (const [c, v] of r.cells) {
      const i = at.get(c);
      if (i === undefined) continue;
      out[i] = cellMd(v);
      any = true;
    }
    return any ? out : null;
  };
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const where = (n: number) => `${name}!${colName(cols[0])}${n}:${colName(cols[width - 1])}${n}`;
  let header: string[] | null = null;
  const rows: SheetRows["rows"] = [];
  for (const r of all) {
    const cells = dense(r);
    if (!cells) continue;
    if (!header) {
      header = cells;
      continue;
    }
    if (budget.written < width) {
      cut = true;
      break;
    }
    budget.written -= width;
    rows.push({ md: line(cells), loc: where(r.n) });
  }
  if (!header) return null;
  return { name, header: `${line(header)}\n|${Array(width).fill("---").join("|")}|`, columns: header, rows, ...(cut ? { cut: true as const } : {}) };
}

/** Whether a cell's text counts as content. */
const filled = (v: string) => v.trim() !== "";

/** A cell's shown value: formulas give their cached result, dates an ISO date, rich text and links their text. */
function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("result" in v) return cellText((v as { result?: ExcelJS.CellValue }).result ?? null);
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((r) => r.text).join("");
    if ("text" in v) return cellText((v as { text: ExcelJS.CellValue }).text);
    if ("error" in v) return String((v as { error: unknown }).error);
    return "";
  }
  return String(v);
}

/** xlsx through exceljs (no macros run: exceljs reads values only). Formulas give their cached values. */
export async function xlsxSheets(buf: Buffer): Promise<SheetRows[]> {
  // exceljs inflates the zip itself: the guard reads it first, so a zip bomb never reaches it.
  await checkZip(buf);
  const wb = new ExcelJS.Workbook();
  try {
    // exceljs types its argument with an older `Buffer`; the bytes are the same.
    await wb.xlsx.load(buf as unknown as Parameters<typeof wb.xlsx.load>[0]);
  } catch {
    throw new MaterialRefused("unreadable");
  }
  const out: SheetRows[] = [];
  const budget = new Budget();
  wb.eachSheet((ws) => {
    const rows: SparseRow[] = [];
    let cut = false;
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      if (cut) return;
      // Only the cells the file holds: `getCell` up to `cellCount` would make one per column up to the last (XFD).
      const cells: [number, string][] = [];
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        const v = cellText(cell.value);
        if (filled(v)) cells.push([c, v]);
      });
      if (cells.length === 0) return;
      if (budget.take(cells.length)) rows.push({ n, cells });
      else cut = true;
    });
    const sheet = buildSheet(ws.name, rows, budget, cut);
    if (sheet) out.push(sheet);
  });
  return out;
}

/** CSV/TSV with RFC 4180 quotes. The sheet is named after the file. */
export function csvSheets(buf: Buffer, sep: "," | "\t", name: string): SheetRows[] {
  const text = decodeText(buf);
  const budget = new Budget();
  const rows: SparseRow[] = [];
  let row: [number, string][] = [];
  let col = 1;
  let n = 1;
  let cell = "";
  let quoted = false;
  let cut = false;
  const endCell = () => {
    if (filled(cell) && col <= LAST_COLUMN) row.push([col, cell]);
    col++;
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.length > 0) {
      if (budget.take(row.length)) rows.push({ n, cells: row });
      else cut = true;
    }
    n++;
    row = [];
    col = 1;
  };
  for (let i = 0; i < text.length && !cut; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) endCell();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else cell += ch;
  }
  if (!cut && (cell !== "" || row.length > 0)) endRow();
  const sheet = buildSheet(name, rows, budget, cut);
  return sheet ? [sheet] : [];
}

/**
 * ODS: `number-rows-repeated` and `number-columns-repeated` expand within the file's budget (a 2 KB file can claim
 * 100 000 rows of 5 000 cells); an empty run adds nothing but still counts in the row and column numbers.
 */
export async function odsSheets(buf: Buffer): Promise<SheetRows[]> {
  const content = await zipXml(buf, "content.xml");
  const book = content && findNode(content, "office:spreadsheet");
  if (!book) throw new MaterialRefused("unreadable");
  const out: SheetRows[] = [];
  const budget = new Budget();
  for (const t of kids(book).filter((k) => tagOf(k) === "table:table")) {
    const rows: SparseRow[] = [];
    let cut = false;
    let n = 1;
    const rowNodes = kids(t).flatMap((k) => (["table:table-header-rows", "table:table-rows", "table:table-row-group"].includes(tagOf(k)) ? kids(k) : [k]));
    for (const r of rowNodes.filter((k) => tagOf(k) === "table:table-row")) {
      if (cut) break;
      const cells: [number, string][] = [];
      let col = 1;
      for (const c of kids(r).filter((k) => ["table:table-cell", "table:covered-table-cell"].includes(tagOf(k)))) {
        const times = repeat(attr(c, "table:number-columns-repeated"));
        const v = odfText(c).trim();
        // Never more cells than the file may still read: a row past that is cut by `take` below anyway.
        if (v) for (let i = 0; i < times && col + i <= LAST_COLUMN && cells.length <= budget.read; i++) cells.push([col + i, v]);
        col += times;
      }
      const times = repeat(attr(r, "table:number-rows-repeated"));
      if (cells.length > 0)
        for (let i = 0; i < times; i++) {
          if (!budget.take(cells.length)) {
            cut = true;
            break;
          }
          rows.push({ n: n + i, cells });
        }
      n += times;
    }
    const sheet = buildSheet(attr(t, "table:name") ?? `Sheet${out.length + 1}`, rows, budget, cut);
    if (sheet) out.push(sheet);
  }
  return out;
}

/** A repeat count from an attribute: a whole number of at least 1. */
const repeat = (v: string | undefined): number => {
  const n = Number(v ?? 1);
  return Number.isInteger(n) && n >= 1 ? n : 1;
};

/** "Summary and first rows" (§3): per sheet, its columns, its row count and its first `first` rows. */
export function sheetSummary(sheets: SheetRows[], first: number): string {
  const rows = (s: SheetRows) => `Rows: ${s.rows.length}${s.cut ? " (the file has more; it was too large to read whole)" : ""}.`;
  return sheets
    .map((s) => [`## ${s.name}`, `Columns: ${s.columns.filter(Boolean).join(", ")}. ${rows(s)}`, [s.header, ...s.rows.slice(0, first).map((r) => r.md)].join("\n")].join("\n\n"))
    .join("\n\n");
}

export const rowCount = (sheets: SheetRows[]): number => sheets.reduce((n, s) => n + s.rows.length, 0);
