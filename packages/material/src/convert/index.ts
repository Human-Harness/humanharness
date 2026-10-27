import { estimateTokens } from "@humanharness/workspace";
import { pagesOf } from "../blocks";
import { PAGE_TOKENS } from "../constants";
import type { ConvertSettings, Converted, MaterialType, SheetRows } from "../types";
import { epubBlocks } from "./epub";
import { htmlBlocks, readablePage } from "./html";
import { measurePdf, pdfBlocks } from "./pdf";
import { csvSheets, odsSheets, rowCount, xlsxSheets } from "./sheet";
import { odpBlocks, pptxBlocks } from "./slides";
import { decodeText, textBlocks } from "./text";
import { docxBlocks, odtBlocks, rtfBlocks } from "./word";

export interface ConvertOptions {
  pageRange?: [number, number];
  settings?: ConvertSettings;
  /** The original's file name (a CSV's sheet is named after it). */
  name: string;
  /** A page fetched from a link: read with readability (menus and footers go); a saved page is read whole. */
  link?: boolean;
}

type SheetType = Extract<MaterialType, "xlsx" | "ods" | "csv" | "tsv">;
const isSheet = (t: MaterialType): t is SheetType => t === "xlsx" || t === "ods" || t === "csv" || t === "tsv";

async function sheetsOf(type: SheetType, buf: Buffer, name: string): Promise<SheetRows[]> {
  if (type === "xlsx") return xlsxSheets(buf);
  if (type === "ods") return odsSheets(buf);
  return csvSheets(buf, type === "tsv" ? "\t" : ",", name);
}

/**
 * Any accepted file into blocks (or sheets), with a page range applied to every family (§7 "Page range"). Runs in the
 * calling thread: the app calls it through `convertInWorker` (convert/isolate.ts), never directly.
 */
export async function convertFile(type: MaterialType, buf: Buffer, opts: ConvertOptions): Promise<Converted> {
  if (isSheet(type)) return { blocks: [], pages: 1, skippedPages: [], sheets: await sheetsOf(type, buf, opts.name) };
  if (type === "pdf") return pdfBlocks(buf, { ...(opts.pageRange ? { pageRange: opts.pageRange } : {}), ...(opts.settings ? { settings: opts.settings } : {}) });
  const blocks =
    type === "docx" ? await docxBlocks(buf)
    : type === "odt" ? await odtBlocks(buf)
    : type === "rtf" ? rtfBlocks(buf)
    : type === "pptx" ? await pptxBlocks(buf)
    : type === "odp" ? await odpBlocks(buf)
    : type === "epub" ? await epubBlocks(buf)
    : type === "html" ? (opts.link ? readablePage(decodeText(buf)).blocks : htmlBlocks(decodeText(buf)))
    : textBlocks(type, buf);
  const pages = pagesOf(blocks);
  const [from, to] = opts.pageRange ?? [1, pages];
  return { blocks: blocks.filter((b) => b.page >= from && b.page <= to), pages, skippedPages: [] };
}

export interface Measured {
  pages: number;
  tokens: number;
  /** PDFs: pages with a text layer, among the first `checked` pages. */
  textPages?: number;
  /** PDFs: the pages looked at for a text layer (a huge file is not read whole to be measured). */
  checked?: number;
  /** Spreadsheets: rows across all sheets. */
  rows?: number;
}

/**
 * The size of a file before anything is converted for good (§7): a PDF's pages and text pages without reading their
 * text twice, a spreadsheet's rows; for the rest it converts (fast, no model) and counts.
 */
export async function measureFile(type: MaterialType, buf: Buffer, name: string, link = false): Promise<Measured> {
  if (type === "pdf") {
    const { pages, textPages, checked } = await measurePdf(buf);
    // The text pages of the part checked stand for the whole file.
    const share = checked > 0 ? textPages / checked : 0;
    return { pages, textPages, checked, tokens: Math.round(share * pages) * PAGE_TOKENS };
  }
  if (isSheet(type)) {
    const sheets = await sheetsOf(type, buf, name);
    let tokens = 0;
    for (const s of sheets) tokens += estimateTokens(s.header) + s.rows.reduce((n, r) => n + estimateTokens(r.md), 0);
    return { pages: 1, rows: rowCount(sheets), tokens };
  }
  const c = await convertFile(type, buf, { name, ...(link ? { link } : {}) });
  return { pages: c.pages, tokens: c.blocks.reduce((n, b) => n + estimateTokens(b.md), 0) };
}
