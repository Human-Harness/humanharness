import { estimateTokens } from "@humanharness/workspace";
import { GARBLED_SHARE, LEFTOVER_REPEATS, MAX, MIN, NOISE_SHARE, NO_STRUCTURE_TOKENS } from "./constants";
import type { Piece } from "./cut";
import type { CheckName } from "./types";

const LETTER = /\p{L}/u;
const NOISE_PATH = /^(contents|table of contents|index|bibliography|references|works cited|sources|índice|indice|bibliografía|bibliografia|sommaire|inhalt|inhaltsverzeichnis|literatur)$/i;
const TOC_LINE = /(\.{3,}|…{2,}|\s{3,})\s*\d+\s*$|,\s*\d+(\s*[-–]\s*\d+)?(,\s*\d+)*\s*$/;
const ENDS_SENTENCE = /[.!?:;)"'»”’\]]\s*$/;

function garbled(md: string): boolean {
  if (md.includes("�")) return true;
  const chars = [...md.replace(/\s/g, "")];
  if (chars.length < 20) return false;
  const nonLetters = chars.filter((c) => !LETTER.test(c) && !/\d/.test(c)).length;
  return nonLetters / chars.length > GARBLED_SHARE;
}

function readingOrder(md: string): boolean {
  const paras = md
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("#") && !p.startsWith("|") && !p.startsWith("```"));
  let breaks = 0;
  for (let i = 0; i + 1 < paras.length; i++) if (!ENDS_SENTENCE.test(paras[i]) && /^\p{Ll}/u.test(paras[i + 1])) breaks++;
  return breaks >= 2;
}

function badTable(md: string): boolean {
  const rows = md.split("\n").filter((l) => /^\s*\|/.test(l) && !/^\s*\|[\s:|-]+\|\s*$/.test(l));
  if (rows.length < 2) return false;
  const counts = new Set(rows.map((r) => r.trim().replace(/^\||\|$/g, "").split("|").length));
  return counts.size > 1;
}

function noise(p: Piece): boolean {
  if (NOISE_PATH.test(p.path.split(" › ").at(-1) ?? "")) return true;
  const lines = p.md.split("\n").filter((l) => l.trim());
  if (lines.length >= 5 && lines.filter((l) => TOC_LINE.test(l)).length / lines.length > NOISE_SHARE) return true;
  const chars = [...p.md.replace(/\s/g, "")];
  return chars.length > 40 && chars.filter((c) => /[\d.]/.test(c)).length / chars.length > 0.5;
}

/**
 * The program's checks on every fragment of one source (§6.1). `flags[i]` lists what piece `i` failed; `sourceIssues`
 * are the source-wide findings as English lines (they go to `sources.json` → `issues` and the review's input).
 */
export function checkPieces(pieces: Piece[]): { flags: CheckName[][]; sourceIssues: string[] } {
  const flags: CheckName[][] = pieces.map(() => []);
  const sourceIssues: string[] = [];
  const total = pieces.reduce((n, p) => n + estimateTokens(p.md), 0);
  // Source-wide: one or two fragments out of a long file; a long file with no headings.
  const fewPieces = pieces.length > 0 && pieces.length <= 2 && total > MAX;
  if (fewPieces) sourceIssues.push(`The whole file became only ${pieces.length} fragment${pieces.length === 1 ? "" : "s"}.`);
  const noHeadings = total > NO_STRUCTURE_TOKENS && pieces.every((p) => p.path === "");
  if (noHeadings) sourceIssues.push("The file has no headings.");
  // Lines that repeat across fragments: headers and footers the removal missed.
  const seen = new Map<string, Set<number>>();
  pieces.forEach((p, i) => {
    // Only short lines: a running header or footer is one, prose never repeats whole lines.
    const short = p.md
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length >= 8 && l.length <= 120 && !l.startsWith("|") && !l.startsWith("#"));
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
    const tokens = estimateTokens(p.md);
    if (garbled(p.md)) f.push("garbled");
    if (readingOrder(p.md)) f.push("reading-order");
    // The cutter only goes above MAX with one block it can't split (a long paragraph, list or table, or a code part
    // that is one huge line), so anything above MAX is flagged; an example or exercise kept whole on purpose is not.
    if ((!p.whole && (tokens < MIN / 3 || tokens > MAX)) || fewPieces) f.push("size");
    if (noHeadings) f.push("no-structure");
    if (badTable(p.md)) f.push("table");
    if (noise(p)) f.push("noise");
    if (repeated.has(i)) f.push("leftover");
  });
  return { flags, sourceIssues };
}
