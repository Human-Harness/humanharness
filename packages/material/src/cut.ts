import { estimateTokens } from "@humanharness/workspace";
import { locRange } from "./blocks";
import { MAX, MIN, TARGET } from "./constants";
import type { MdBlock, SheetRows } from "./types";

/** A fragment before it gets an id and front matter. */
export interface Piece {
  /** Heading path: "Fractions › Equivalent fractions › Example 2"; "" before the first heading. */
  path: string;
  md: string;
  location: string;
  /** The pages it spans, in order. */
  pages: number[];
  /** An example or exercise kept whole (§5.4); the size check doesn't flag it. */
  whole?: true;
  /** The program's guess before labelling (§4.1 `kind`): "example" or "exercise" from the heading. */
  kind?: string;
}

/** A heading that starts an example or an exercise (§5.4), in English and in the languages the material may use. */
const WHOLE = /^(example|exercise|problem|worked example|ejemplo|ejercicio|problema|exemple|exercice|beispiel|aufgabe|esempio|esercizio|exemplo|exerc[ií]cio)\b/i;

interface Section {
  path: string[];
  level: number;
  blocks: MdBlock[];
}

const headingText = (b: MdBlock) => b.md.replace(/^#+\s*/, "").trim();

function sections(blocks: MdBlock[]): Section[] {
  const out: Section[] = [];
  const stack: string[] = [];
  let current: Section = { path: [], level: 0, blocks: [] };
  for (const b of blocks) {
    if (b.kind === "heading" && (b.level ?? 1) <= 3) {
      if (current.blocks.length > 0) out.push(current);
      const level = b.level ?? 1;
      stack.length = level - 1;
      stack[level - 1] = headingText(b);
      current = { path: stack.filter((s) => s !== undefined), level, blocks: [b] };
    } else current.blocks.push(b);
  }
  if (current.blocks.length > 0) out.push(current);
  return out;
}

const tokensOf = (bs: MdBlock[]) => estimateTokens(bs.map((b) => b.md).join("\n\n"));

function piece(path: string[], bs: MdBlock[], extra: Partial<Piece> = {}): Piece {
  const pages = [...new Set(bs.map((b) => b.page))].sort((a, b) => a - b);
  return { path: path.join(" › "), md: bs.map((b) => b.md).join("\n\n"), location: locRange(bs[0].loc, bs[bs.length - 1].loc), pages, ...extra };
}

/** A section above MAX split at block boundaries (paragraphs, lists, tables stay whole) into pieces near TARGET (§5.2). */
function split(s: Section): Section[] {
  const out: Section[] = [];
  let run: MdBlock[] = [];
  for (const b of s.blocks) {
    if (run.length > 0 && tokensOf([...run, b]) > TARGET && tokensOf(run) >= MIN) {
      out.push({ ...s, blocks: run });
      run = [];
    }
    run.push(b);
  }
  if (run.length > 0) out.push({ ...s, blocks: run });
  return out;
}

// The path drops missing levels ("## B" with no "# A" above is ["B"]), so the parent is the path less its last part.
const parentOf = (s: Section) => s.path.slice(0, -1).join(" › ");

const FENCED = /^(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)\n?\1\s*$/;
const LINES = /^lines (\d+)–(\d+)$/;

/**
 * A code block above MAX (a converter keeps a whole XML file, a JSON array or a long function as one block) split by
 * lines into blocks near TARGET, each fenced again. When the block's `lines a–b` range is its body's lines (a code
 * file's part) or its body plus the two fence lines (a fenced block in Markdown), each part gets its own range;
 * otherwise (JSON printed again from a one-line file) every part keeps the block's location.
 */
function splitCode(b: MdBlock): MdBlock[] {
  const m = b.kind === "code" && estimateTokens(b.md) > MAX ? FENCED.exec(b.md) : null;
  if (!m) return [b];
  const [, fence, info] = m;
  const all = m[3].split("\n");
  const range = LINES.exec(b.loc);
  const span = range ? Number(range[2]) - Number(range[1]) + 1 : 0;
  const from = !range ? null : span === all.length ? Number(range[1]) : span === all.length + 2 ? Number(range[1]) + 1 : null;
  const fenceOf = (ls: string[]) => `${fence}${info}\n${ls.join("\n")}\n${fence}`;
  const out: MdBlock[] = [];
  let run: string[] = [];
  let at = 0;
  const flush = (end: number) => {
    if (run.length === 0) return;
    const loc = from === null ? b.loc : end - at === 1 ? `lines ${from + at}` : `lines ${from + at}–${from + end - 1}`;
    out.push({ ...b, md: fenceOf(run), loc });
    run = [];
    at = end;
  };
  all.forEach((line, i) => {
    if (run.length > 0 && estimateTokens(fenceOf([...run, line])) > TARGET) flush(i);
    run.push(line);
  });
  flush(all.length);
  return out;
}

/** Blocks into fragments (§5): cut at #–###, split above MAX, merge below MIN, examples and exercises whole. */
export function cutBlocks(blocks: MdBlock[]): Piece[] {
  const merged: Section[] = [];
  for (const s of sections(blocks)) {
    const prev = merged[merged.length - 1];
    // A heading with nothing under it but its children ("# Fractions" then "## Equivalent…") joins its first child,
    // which gives the path.
    if (prev && prev.blocks.every((b) => b.kind === "heading") && s.path.length > prev.path.length) {
      prev.blocks.push(...s.blocks);
      prev.path = s.path;
      prev.level = s.level;
      continue;
    }
    // §5.3: a short section joins the next one under the same parent; the first keeps its path.
    if (prev && tokensOf(prev.blocks) < MIN && !isWhole(prev) && !isWhole(s) && parentOf(prev) === parentOf(s) && prev.level <= s.level) {
      prev.blocks.push(...s.blocks);
      continue;
    }
    merged.push({ ...s, blocks: [...s.blocks] });
  }
  return merged.flatMap((s): Piece[] => {
    const whole = isWhole(s);
    const kind = whole ? (/exerc|problem|aufgabe|esercizio/i.test(s.path.at(-1) ?? "") ? "exercise" : "example") : undefined;
    if (whole) return [piece(s.path, s.blocks, { whole: true, ...(kind ? { kind } : {}) })];
    // Code too long for one fragment is split by lines, except inside an example or exercise kept whole.
    const blocks = s.blocks.flatMap(splitCode);
    if (tokensOf(blocks) <= MAX) return [piece(s.path, blocks)];
    return split({ ...s, blocks }).map((part) => piece(s.path, part.blocks));
  });
}

function isWhole(s: Section): boolean {
  const last = s.path[s.path.length - 1];
  return last !== undefined && s.blocks[0]?.kind === "heading" && WHOLE.test(last);
}

/** A sheet's rows into table fragments of about TARGET tokens, each repeating the header row (§3). */
export function cutRows(sheet: SheetRows): Piece[] {
  const out: Piece[] = [];
  let run: { md: string; loc: string }[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const first = run[0].loc;
    const last = run[run.length - 1].loc;
    // "Data!A2:C2" … "Data!A9:C9" → "Data!A2:C9"; "S!A2" … "S!A3" → "S!A2:A3".
    const location = `${first.split(":")[0]}:${last.split("!").pop()?.split(":").pop() ?? last}`;
    out.push({ path: sheet.name, md: `${sheet.header}\n${run.map((r) => r.md).join("\n")}`, location, pages: [1] });
    run = [];
  };
  for (const r of sheet.rows) {
    if (run.length > 0 && estimateTokens(`${sheet.header}\n${[...run, r].map((x) => x.md).join("\n")}`) > TARGET) flush();
    run.push(r);
  }
  flush();
  return out;
}
