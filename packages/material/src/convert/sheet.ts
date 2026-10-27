import ExcelJS from "exceljs";
import { MaterialRefused } from "../blocks";
import type { SheetRows } from "../types";
import { decodeText } from "./text";
import { attr, findNode, kids, odfText, tagOf, zipXml } from "./word";
import { checkZip } from "./zip";

/** At most this many rows are read from one ODS sheet (a repeated row can claim a million). */
const ODS_MAX_ROWS = 100_000;
/** At most this many columns are read from one ODS row (a repeated cell can claim the sheet's 16 384). */
const ODS_MAX_COLUMNS = 1024;

const cellMd = (v: string) => v.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
const colName = (n: number): string => (n <= 0 ? "" : colName(Math.floor((n - 1) / 26)) + String.fromCharCode(65 + ((n - 1) % 26)));

/** One row's cells and its real row number in the sheet. */
type NumberedRow = { cells: string[]; n: number };

/** Rows into one sheet: the first non-empty row is the header, empty rows are dropped, locations keep row numbers. */
function numberedSheet(name: string, all: NumberedRow[]): SheetRows | null {
  const rows = all.filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (rows.length === 0) return null;
  const [head, ...data] = rows;
  const width = Math.max(...rows.map((r) => r.cells.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")].map(cellMd);
  const line = (r: string[]) => `| ${pad(r).join(" | ")} |`;
  const last = colName(width);
  return {
    name,
    header: `${line(head.cells)}\n|${Array(width).fill("---").join("|")}|`,
    columns: pad(head.cells),
    rows: data.map((r) => ({ md: line(r.cells), loc: `${name}!A${r.n}:${last}${r.n}` })),
  };
}

/** Rows (arrays of cell text, the first one at `firstRow`) into one sheet. */
export const toSheet = (name: string, raw: string[][], firstRow = 1): SheetRows | null => numberedSheet(name, raw.map((cells, i) => ({ cells, n: firstRow + i })));

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
  wb.eachSheet((ws) => {
    const rows: NumberedRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const cells: string[] = [];
      for (let c = 1; c <= row.cellCount; c++) cells.push(cellText(row.getCell(c).value));
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      rows.push({ cells, n });
    });
    const sheet = numberedSheet(ws.name, rows);
    if (sheet) out.push(sheet);
  });
  return out;
}

/** CSV/TSV with RFC 4180 quotes. The sheet is named after the file. */
export function csvSheets(buf: Buffer, sep: "," | "\t", name: string): SheetRows[] {
  const text = decodeText(buf);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) rows.push([...row, cell]);
  const sheet = toSheet(name, rows);
  return sheet ? [sheet] : [];
}

/**
 * ODS: `number-rows-repeated` and `number-columns-repeated` expand, capped (a file can claim a million rows); an
 * empty run adds nothing but still counts in the row numbers.
 */
export async function odsSheets(buf: Buffer): Promise<SheetRows[]> {
  const content = await zipXml(buf, "content.xml");
  const book = content && findNode(content, "office:spreadsheet");
  if (!book) throw new MaterialRefused("unreadable");
  const out: SheetRows[] = [];
  for (const t of kids(book).filter((k) => tagOf(k) === "table:table")) {
    const rows: NumberedRow[] = [];
    let n = 1;
    const rowNodes = kids(t).flatMap((k) => (["table:table-header-rows", "table:table-rows", "table:table-row-group"].includes(tagOf(k)) ? kids(k) : [k]));
    for (const r of rowNodes.filter((k) => tagOf(k) === "table:table-row")) {
      const cells: string[] = [];
      for (const c of kids(r).filter((k) => ["table:table-cell", "table:covered-table-cell"].includes(tagOf(k)))) {
        const times = Math.min(repeat(attr(c, "table:number-columns-repeated")), ODS_MAX_COLUMNS - cells.length);
        const v = odfText(c).trim();
        for (let i = 0; i < times; i++) cells.push(v);
      }
      while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
      const times = repeat(attr(r, "table:number-rows-repeated"));
      if (cells.length > 0) for (let i = 0; i < times && rows.length < ODS_MAX_ROWS; i++) rows.push({ cells, n: n + i });
      n += times;
    }
    const sheet = numberedSheet(attr(t, "table:name") ?? `Sheet${out.length + 1}`, rows);
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
  return sheets
    .map((s) => [`## ${s.name}`, `Columns: ${s.columns.filter(Boolean).join(", ")}. Rows: ${s.rows.length}.`, [s.header, ...s.rows.slice(0, first).map((r) => r.md)].join("\n")].join("\n\n"))
    .join("\n\n");
}

export const rowCount = (sheets: SheetRows[]): number => sheets.reduce((n, s) => n + s.rows.length, 0);
