import { estimateTokens } from "@humanharness/workspace";
import { GARBLED_SHARE, LEFTOVER_REPEATS, MAX, MIN, NOISE_SHARE, NO_STRUCTURE_TOKENS } from "./constants";
import type { Piece } from "./cut";
import type { CheckName } from "./types";

const LETTER = /\p{L}/u;
const NOISE_PATH = /^(contents|table of contents|index|bibliography|references|works cited|sources|índice|indice|bibliografía|bibliografia|sommaire|inhalt|inhaltsverzeichnis|literatur)$/i;
const TOC_LINE = /(\.{3,}|…{2,}|\s{3,})\s*\d+\s*$|,\s*\d+(\s*[-–]\s*\d+)?(,\s*\d+)*\s*$/;
const ENDS_SENTENCE = /[.!?:;)"'»”’\]]\s*$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|[\s:|-]+\|\s*$/;
// A column bar; an escaped "\|" is text inside a cell.
const CELL_BAR = /(?<!\\)\|/;

/**
 * The fragment's lines outside fenced blocks; a fenced line becomes "" so paragraph breaks stay where they were. Code
 * and structured data are not prose: only the replacement-character check reads them.
 */
function outsideFences(md: string): string[] {
  const out: string[] = [];
  let open: string | null = null;
  for (const line of md.split("\n")) {
    const m = FENCE.exec(line);
    if (open === null && m) open = m[1];
    else if (open !== null && m && m[1][0] === open[0] && m[1].length >= open.length && !line.trim().slice(m[1].length).trim()) open = null;
    else if (open === null) {
      out.push(line);
      continue;
    }
    out.push("");
  }
  return out;
}

/** The prose's characters: no fences, no table separator rows, no column bars, no whitespace. */
function proseChars(lines: string[]): string[] {
  const text = lines
    .filter((l) => !TABLE_SEPARATOR.test(l))
    .map((l) => (TABLE_ROW.test(l) ? l.split(CELL_BAR).join(" ") : l))
    .join("\n");
  return [...text.replace(/\s/g, "")];
}

function garbled(md: string, lines: string[]): boolean {
  if (md.includes("�")) return true;
  const chars = proseChars(lines);
  if (chars.length < 20) return false;
  const nonLetters = chars.filter((c) => !LETTER.test(c) && !/\d/.test(c)).length;
  return nonLetters / chars.length > GARBLED_SHARE;
}

function readingOrder(lines: string[]): boolean {
  const paras = lines
    .join("\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#") && !p.startsWith("|"));
  let breaks = 0;
  for (let i = 0; i + 1 < paras.length; i++) if (!ENDS_SENTENCE.test(paras[i]) && /^\p{Ll}/u.test(paras[i + 1])) breaks++;
  return breaks >= 2;
}

function badTable(lines: string[]): boolean {
  const rows = lines.filter((l) => TABLE_ROW.test(l) && !TABLE_SEPARATOR.test(l));
  if (rows.length < 2) return false;
  const counts = new Set(rows.map((r) => r.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(CELL_BAR).length));
  return counts.size > 1;
}

function noise(p: Piece, lines: string[]): boolean {
  if (NOISE_PATH.test(p.path.split(" › ").at(-1) ?? "")) return true;
  // A table's rows are data: a sheet of numbers is not a table of contents.
  const text = lines.filter((l) => l.trim() && !TABLE_ROW.test(l));
  if (text.length >= 5 && text.filter((l) => TOC_LINE.test(l)).length / text.length > NOISE_SHARE) return true;
  const chars = [...text.join("").replace(/\s/g, "")];
  return chars.length > 40 && chars.filter((c) => /[\d.]/.test(c)).length / chars.length > 0.5;
}

/**
 * The program's checks on every fragment of one source (§6.1). `flags[i]` lists what piece `i` failed; `sourceIssues`
 * are the source-wide findings as English lines (they go to `sources.json` → `issues` and the review's input).
 */
export function checkPieces(pieces: Piece[]): { flags: CheckName[][]; sourceIssues: string[] } {
  const flags: CheckName[][] = pieces.map(() => []);
  const sourceIssues: string[] = [];
  const prose = pieces.map((p) => outsideFences(p.md));
  const total = pieces.reduce((n, p) => n + estimateTokens(p.md), 0);
  // Source-wide: one or two fragments out of a file that should have made several; a long file with no headings (or
  // only a title). A spreadsheet's row fragments all carry the sheet's name and are structured by their rows.
  const fewPieces = pieces.length > 0 && pieces.length <= 2 && total > MAX * 2;
  if (fewPieces) sourceIssues.push(`The whole file became only ${pieces.length} fragment${pieces.length === 1 ? "" : "s"}.`);
  const allRows = prose.every((ls) => ls.every((l) => !l.trim() || TABLE_ROW.test(l)));
  const noHeadings = total > NO_STRUCTURE_TOKENS && new Set(pieces.map((p) => p.path)).size <= 1 && !allRows;
  if (noHeadings) sourceIssues.push("The file has no headings.");
  // Lines that repeat across fragments: headers and footers the removal missed.
  const seen = new Map<string, Set<number>>();
  prose.forEach((ls, i) => {
    // Only short prose lines: a running header or footer is one, prose never repeats whole lines, and code does.
    const short = ls.map((l) => l.trim()).filter((l) => l.length >= 8 && l.length <= 120 && !l.startsWith("|") && !l.startsWith("#"));
    for (const line of new Set(short)) {
      const at = seen.get(line) ?? new Set<number>();
      at.add(i);
      seen.set(line, at);
    }
  });
  const repeated = new Set<number>();
  for (const at of seen.values()) if (at.size >= LEFTOVER_REPEATS) for (const i of at) repeated.add(i);
  pieces.forEach((p, i) => {
    const f = flags[i];
    const lines = prose[i];
    const tokens = estimateTokens(p.md);
    if (garbled(p.md, lines)) f.push("garbled");
    if (readingOrder(lines)) f.push("reading-order");
    // The cutter only goes above MAX with one block it can't split (a long paragraph, list or table, or a code part
    // that is one huge line), so anything above MAX is flagged; an example or exercise kept whole on purpose is not.
    if ((!p.whole && (tokens < MIN / 3 || tokens > MAX)) || fewPieces) f.push("size");
    if (noHeadings) f.push("no-structure");
    if (badTable(lines)) f.push("table");
    if (noise(p, lines)) f.push("noise");
    if (repeated.has(i)) f.push("leftover");
  });
  return { flags, sourceIssues };
}
