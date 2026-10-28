/** One character of the rendered text: the text node it is in and its offset there. */
export interface RunAt {
  node: Text;
  offset: number;
}
export interface TextRuns {
  /** The rendered text, every whitespace run one space, blocks joined by one space (as `project` does with the source). */
  plain: string;
  at: RunAt[];
}

const BLOCKS = new Set(["P", "H1", "H2", "H3", "H4", "H5", "H6", "LI", "TD", "TH", "TR", "PRE", "BLOCKQUOTE", "DIV", "UL", "OL", "TABLE", "HR", "BR", "FIGURE"]);
const isSpace = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r" || c === " ";

/** The rendered text under `root` (diagrams and buttons left out) and where each character lives. One pass. */
export function textRuns(root: HTMLElement): TextRuns {
  const plain: string[] = [];
  const at: RunAt[] = [];
  let space: RunAt | null = null;
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      const node = n as Text;
      const s = node.data;
      for (let i = 0; i < s.length; i++) {
        if (isSpace(s[i])) {
          if (!space) space = { node, offset: i };
          continue;
        }
        if (space && plain.length > 0) {
          plain.push(" ");
          at.push(space);
        }
        space = null;
        plain.push(s[i]);
        at.push({ node, offset: i });
      }
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as HTMLElement;
    if (el.classList.contains("hh-md-diagram") || el.tagName === "BUTTON" || el.tagName.toLowerCase() === "svg" || el.getAttribute("aria-hidden") === "true") return;
    const block = BLOCKS.has(el.tagName);
    // A block boundary is a space: it maps to the last character before it (a mark never starts on it).
    if (block && !space && at.length > 0) space = at[at.length - 1];
    for (const c of el.childNodes) walk(c);
    if (block && !space && at.length > 0) space = at[at.length - 1];
  };
  walk(root);
  return { plain: plain.join(""), at };
}

/** The `nth` non-overlapping match of `want` in `plain`, as [start, end), or null. `indexOf` only. */
export function findMark(plain: string, want: string, nth: number): [number, number] | null {
  if (!want) return null;
  let k = 0;
  for (let i = plain.indexOf(want); i >= 0; i = plain.indexOf(want, i + want.length)) {
    if (k === nth) return [i, i + want.length];
    k++;
  }
  return null;
}

export type MarkTone = "question" | "comment" | "done";
export interface MarkSpec {
  id: string;
  want: string;
  nth: number;
  tone: MarkTone;
}

const HIGHLIGHTS = ["hh-review-question", "hh-review-comment", "hh-review-done", "hh-review-active"] as const;

type HighlightApi = { highlights?: Map<string, unknown> };
type HighlightCtor = new (...ranges: Range[]) => unknown;

/**
 * Finds every mark in the rendered text and draws it with the CSS Custom Highlight API (no change to the DOM, no CSP
 * change). Returns the ranges it found, by comment id (the column and the focus markers place themselves from them).
 * `active` gets a stronger highlight. Without the API (tests), nothing is drawn.
 */
export function paintMarks(root: HTMLElement, marks: MarkSpec[], active: string | null = null): Map<string, Range> {
  const runs = textRuns(root);
  const ranges = new Map<string, Range>();
  const byTone: Record<(typeof HIGHLIGHTS)[number], Range[]> = { "hh-review-question": [], "hh-review-comment": [], "hh-review-done": [], "hh-review-active": [] };
  for (const m of marks) {
    const hit = findMark(runs.plain, m.want, m.nth);
    if (!hit) continue;
    const a = runs.at[hit[0]];
    const b = runs.at[hit[1] - 1];
    const r = document.createRange();
    r.setStart(a.node, a.offset);
    r.setEnd(b.node, b.offset + 1);
    ranges.set(m.id, r);
    byTone[m.id === active ? "hh-review-active" : (`hh-review-${m.tone}` as const)].push(r);
  }
  const api = (globalThis as { CSS?: HighlightApi }).CSS;
  const Highlight = (globalThis as { Highlight?: HighlightCtor }).Highlight;
  if (api?.highlights && Highlight) for (const name of HIGHLIGHTS) api.highlights.set(name, new Highlight(...byTone[name]));
  return ranges;
}

/** Removes the reader's highlights (the reader closed or the document changed). */
export function clearMarks(): void {
  const api = (globalThis as { CSS?: HighlightApi }).CSS;
  if (api?.highlights) for (const name of HIGHLIGHTS) api.highlights.delete(name);
}
