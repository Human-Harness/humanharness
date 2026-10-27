import { MaterialRefused, plainLine } from "../blocks";
import { MAX_PAGES, RUNNING_SHARE } from "../constants";
import type { ConvertSettings, MdBlock } from "../types";

interface Item {
  str: string;
  x: number;
  y: number;
  size: number;
  width: number;
  bold: boolean;
}
interface Line {
  text: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
  page: number;
  /** In the top or bottom band of the page, where running headers, footers and page numbers sit. */
  edge: boolean;
}
/** A page's box, in PDF points. */
interface Box {
  width: number;
  height: number;
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDoc = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;
let lib: Promise<PdfJs> | null = null;
/** pdfjs in Node: the worker module is imported first so pdfjs runs it in this thread (no worker file to ship). */
function pdfjs(): Promise<PdfJs> {
  lib ??= (async () => {
    await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    return import("pdfjs-dist/legacy/build/pdf.mjs");
  })();
  return lib;
}

/** Any failure that is not already a refusal is an unreadable file: a hostile or broken PDF never crashes the caller. */
const refusal = (err: unknown) => (err instanceof MaterialRefused ? err : new MaterialRefused((err as { name?: string } | null)?.name === "PasswordException" ? "protected" : "unreadable"));

/**
 * Opens the file without running anything from it (no font loading, no system fonts, no XFA forms; pdfjs 6 has no
 * eval path left, so the old `isEvalSupported: false` is gone: the document is the person's data, never code), runs
 * `fn`, and always tears the document down. Every error becomes a refusal with its reason.
 */
async function withDoc<T>(data: Buffer, fn: (doc: PdfDoc) => Promise<T>): Promise<T> {
  let task: ReturnType<PdfJs["getDocument"]> | null = null;
  try {
    const { getDocument } = await pdfjs();
    task = getDocument({
      data: new Uint8Array(data),
      disableFontFace: true,
      useSystemFonts: false,
      enableXfa: false,
      stopAtErrors: false,
      verbosity: 0,
    });
    return await fn(await task.promise);
  } catch (err) {
    throw refusal(err);
  } finally {
    await task?.destroy().catch(() => undefined);
  }
}

/** The fallback page box: US Letter. */
const LETTER: Box = { width: 612, height: 792 };

/**
 * A page's text items, with their size and position. With `fonts`, the page's operator list is read first so pdfjs
 * loads its fonts and each item's weight is known (the text content alone only names a generic family). That costs a
 * pass over the page's drawing, so it runs only where the weight matters.
 */
async function pageItems(doc: PdfDoc, n: number, fonts = false): Promise<{ items: Item[]; box: Box }> {
  const page = await doc.getPage(n);
  const [x0, y0, x1, y1] = page.view;
  const box = Number.isFinite(x1 - x0) && Number.isFinite(y1 - y0) && x1 > x0 && y1 > y0 ? { width: x1 - x0, height: y1 - y0 } : LETTER;
  try {
    return { items: await readItems(page, fonts), box };
  } finally {
    page.cleanup();
  }
}

type PdfPage = Awaited<ReturnType<PdfDoc["getPage"]>>;
async function readItems(page: PdfPage, fonts: boolean): Promise<Item[]> {
  if (fonts) await page.getOperatorList();
  const content = await page.getTextContent();
  const styles = content.styles as Record<string, { fontFamily?: string } | undefined>;
  const items: Item[] = [];
  for (const raw of content.items as { str?: unknown; transform?: unknown; width?: unknown; fontName?: unknown }[]) {
    if (typeof raw.str !== "string" || !Array.isArray(raw.transform) || !raw.str.trim()) continue;
    const [a, b, , , e, f] = raw.transform as number[];
    if (![a, b, e, f].every(Number.isFinite)) continue;
    const name = typeof raw.fontName === "string" ? raw.fontName : "";
    const family = Object.hasOwn(styles, name) ? (styles[name]?.fontFamily ?? "") : "";
    let bold = /bold|black|heavy/i.test(`${name} ${family}`);
    if (fonts) {
      try {
        const font = page.commonObjs.has(name) ? (page.commonObjs.get(name) as { name?: unknown; bold?: unknown } | null) : null;
        bold ||= font?.bold === true || (typeof font?.name === "string" && /bold|black|heavy/i.test(font.name));
      } catch {
        // Not loaded: keep what the style said.
      }
    }
    items.push({ str: raw.str, x: e, y: f, size: Math.round(Math.hypot(a, b) * 10) / 10, width: typeof raw.width === "number" && Number.isFinite(raw.width) ? raw.width : 0, bold });
  }
  return items;
}

/** Half the width of the empty band around the page's middle that two columns need, in points. */
const GUTTER = 7;

/**
 * Two columns only when a real gutter splits the page: no item touches the band [mid - GUTTER, mid + GUTTER], each
 * side holds more than one item, and on every baseline with items on both sides the gap between them is at least
 * 1.5× the font size (a single column whose lines happen to be split into two items near the middle stays one).
 */
function hasGutter(items: Item[], mid: number): boolean {
  const left = items.filter((i) => i.x + i.width <= mid - GUTTER);
  const right = items.filter((i) => i.x >= mid + GUTTER);
  if (left.length < 2 || right.length < 2 || left.length + right.length !== items.length) return false;
  // The nearest right item per whole-point baseline (and its size), so the check stays linear on busy pages.
  const nearest = new Map<number, { x: number; size: number }>();
  for (const r of right) {
    const k = Math.round(r.y);
    const seen = nearest.get(k);
    if (!seen || r.x < seen.x) nearest.set(k, { x: r.x, size: r.size });
  }
  for (const l of left) {
    const end = l.x + l.width;
    for (let k = Math.round(l.y) - 2; k <= Math.round(l.y) + 2; k++) {
      const r = nearest.get(k);
      if (r && r.x - end < 1.5 * Math.max(l.size, r.size)) return false;
    }
  }
  return true;
}

/** Items into lines: same baseline (±2 pt), left to right. Two columns: everything left of the gutter first. */
function lines(items: Item[], page: number, columns: boolean | undefined, box: Box): Line[] {
  const mid = box.width / 2;
  const band = box.height * 0.1;
  const twoColumns = columns ?? hasGutter(items, mid);
  const groups = twoColumns ? [items.filter((i) => i.x < mid), items.filter((i) => i.x >= mid)] : [items];
  const out: Line[] = [];
  for (const group of groups) {
    const sorted = [...group].sort((p, q) => q.y - p.y || p.x - q.x);
    let current: Item[] = [];
    const flush = () => {
      if (current.length === 0) return;
      current.sort((p, q) => p.x - q.x);
      const text = current.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim();
      const y = current[0].y;
      out.push({ text, x: current[0].x, y, size: Math.max(...current.map((i) => i.size)), bold: current.every((i) => i.bold), page, edge: y > box.height - band || y < band });
      current = [];
    };
    for (const it of sorted) {
      if (current.length > 0 && Math.abs(current[0].y - it.y) > 2) flush();
      current.push(it);
    }
    flush();
  }
  return out;
}

const runningKey = (l: Line) => l.text.replace(/\d+/g, "#");

/**
 * Lines in the page's top or bottom band that repeat on most pages (by their text with digits blanked): running
 * headers and footers. Body text that repeats is kept.
 */
function running(all: Line[][]): Set<string> {
  const count = new Map<string, number>();
  for (const page of all) for (const k of new Set(page.filter((l) => l.edge).map(runningKey))) count.set(k, (count.get(k) ?? 0) + 1);
  const pages = all.filter((p) => p.length > 0).length;
  return new Set([...count].filter(([k, n]) => pages >= 3 && n / pages >= RUNNING_SHARE && k.length <= 120).map(([k]) => k));
}

/** Heading text that stays text: leading markup and a trailing run of `#` (a closing sequence) are escaped. */
const headingText = (t: string) => plainLine(t).replace(/(?<!\\)(#+)\s*$/, "\\$1");

const PAGE_NUMBER = /^\s*(page\s*)?\d+(\s*(of|\/)\s*\d+)?\s*$/i;
const ENDS = /[.!?:;)"'»”’]$/;

/**
 * A PDF into blocks (§3). Body size is the most common line size (by characters); a line at least 1.25× it is a
 * heading (level 1 from 1.6×, else 2; 3 from 1.15× when bold), or, with `headingsByWeight`, a short bold line that
 * does not end a sentence is a level-2 heading. Paragraphs end at a gap larger than 1.5 lines, a size change, or a
 * page break after a line that ends a sentence. Running headers, footers and page numbers in the page's edge bands
 * are dropped; a word split by an end-of-line hyphen is joined. Only the pages in `pageRange` are read. Throws
 * `MaterialRefused` (never anything else) when the file can't be read.
 */
export async function pdfBlocks(data: Buffer, opts: { pageRange?: [number, number]; settings?: ConvertSettings } = {}): Promise<{ blocks: MdBlock[]; pages: number; skippedPages: number[] }> {
  return withDoc(data, async (doc) => {
    const pages = doc.numPages;
    const [from, to] = opts.pageRange ?? [1, pages];
    const byWeight = opts.settings?.headingsByWeight === true;
    const read = async (n: number, fonts: boolean) => {
      const { items, box } = await pageItems(doc, n, fonts);
      return { items, lines: lines(items, n, opts.settings?.columns, box) };
    };
    const perPage: Line[][] = [];
    const skippedPages: number[] = [];
    for (let n = 1; n <= pages; n++) {
      if (n < from || n > to) {
        perPage.push([]);
        continue;
      }
      // By weight, every page needs its fonts; by size, only the pages with a level-3 candidate (below).
      const page = await read(n, byWeight);
      if (page.items.length === 0) skippedPages.push(n);
      perPage.push(page.lines);
    }
    const drop = running(perPage);
    const keep = (p: Line[]) => p.filter((l) => !(l.edge && (drop.has(runningKey(l)) || PAGE_NUMBER.test(l.text))));
    const kept = perPage.map(keep);
    const sizes = new Map<number, number>();
    for (const l of kept.flat()) sizes.set(l.size, (sizes.get(l.size) ?? 0) + l.text.length);
    const bodySize = [...sizes].sort((p, q) => q[1] - p[1])[0]?.[0] ?? 11;
    const level3 = (l: Line) => l.size >= bodySize * 1.15 && l.size < bodySize * 1.25;
    if (!byWeight) for (let i = 0; i < kept.length; i++) if (kept[i].some(level3)) kept[i] = keep((await read(i + 1, true)).lines);
    const level = (l: Line): number | null => {
      if (byWeight) return l.bold && l.text.length <= 80 && !ENDS.test(l.text) ? 2 : null;
      if (l.size >= bodySize * 1.6) return 1;
      if (l.size >= bodySize * 1.25) return 2;
      if (level3(l) && l.bold) return 3;
      return null;
    };
    const blocks: MdBlock[] = [];
    let para: Line[] = [];
    const flush = () => {
      if (para.length === 0) return;
      let text = "";
      for (const l of para) {
        // §3: a word split by an end-of-line hyphen is joined.
        if (/\p{L}-$/u.test(text) && /^\p{Ll}/u.test(l.text)) text = text.slice(0, -1) + l.text;
        else text = text ? `${text} ${l.text}` : l.text;
      }
      blocks.push({ kind: "para", md: plainLine(text), loc: `p.${para[0].page}`, page: para[0].page });
      para = [];
    };
    for (const page of kept) {
      for (const l of page) {
        const h = level(l);
        if (h !== null) {
          flush();
          blocks.push({ kind: "heading", level: h, md: `${"#".repeat(h)} ${headingText(l.text)}`, loc: `p.${l.page}`, page: l.page });
          continue;
        }
        const prev = para[para.length - 1];
        const gap = prev && prev.page === l.page ? prev.y - l.y : 0;
        // A negative gap is a jump back up the page: the next column.
        if (prev && (prev.page !== l.page ? ENDS.test(prev.text) : gap > l.size * 1.5 * 1.2 || gap < 0 || Math.abs(prev.size - l.size) > 0.5)) flush();
        para.push(l);
      }
    }
    flush();
    return { blocks, pages, skippedPages };
  });
}

/**
 * Pages, and pages with a text layer, without converting: intake measures before it warns (§7). Only the first `cap`
 * pages are checked for text (`checked` says how many): a huge file is not read page by page just to be measured.
 */
export async function measurePdf(data: Buffer, cap = MAX_PAGES): Promise<{ pages: number; textPages: number; checked: number }> {
  return withDoc(data, async (doc) => {
    const checked = Math.min(doc.numPages, Math.max(0, cap));
    let textPages = 0;
    for (let n = 1; n <= checked; n++) if ((await pageItems(doc, n)).items.length > 0) textPages++;
    return { pages: doc.numPages, textPages, checked };
  });
}
