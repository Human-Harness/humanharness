import type { BlockAnswer, ChatEntry } from "./client";

export type MarkKind = "ok" | "gap" | "wrong" | "note";
export interface Mark {
  quote: string;
  kind: MarkKind;
  comment?: string;
}
export interface AnnotationView {
  ref: string;
  field?: string;
  marks: Mark[];
}

const KINDS: readonly string[] = ["ok", "gap", "wrong", "note"];

/** The annotate block's data, keeping only well-formed marks (the agent wrote it; the app checked it already). */
export function readAnnotation(data: unknown): AnnotationView | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.ref !== "string" || !Array.isArray(d.marks)) return null;
  const marks = d.marks.flatMap((m): Mark[] => {
    const x = m as Record<string, unknown> | null;
    if (!x || typeof x.quote !== "string" || !x.quote || !KINDS.includes(x.kind as string)) return [];
    return [{ quote: x.quote, kind: x.kind as MarkKind, ...(typeof x.comment === "string" && x.comment ? { comment: x.comment } : {}) }];
  });
  return marks.length > 0 ? { ref: d.ref, ...(typeof d.field === "string" ? { field: d.field } : {}), marks } : null;
}

/** The answer `ref` names among the entries before `before` (all when null): by block id, or "last". */
export function findAnswer(entries: Pick<ChatEntry, "id" | "blocks">[], before: string | null, ref: string): BlockAnswer | null {
  const end = before === null ? -1 : entries.findIndex((e) => e.id === before);
  const answers = (end < 0 ? entries : entries.slice(0, end)).flatMap((e) => e.blocks.flatMap((b) => (b.input ? [b.input] : [])));
  return (ref === "last" ? answers.at(-1) : answers.find((a) => a.blockId === ref)) ?? null;
}

/** The text the marks are on: the named field, else the answer's longest text. */
export function answerText(answer: BlockAnswer, field?: string): string | null {
  const v = answer.value;
  if (field !== undefined) return typeof v[field] === "string" ? (v[field] as string) : null;
  const texts = Object.values(v).filter((x): x is string => typeof x === "string" && x.trim().length > 0);
  return texts.length > 0 ? texts.reduce((a, b) => (b.length > a.length ? b : a)) : null;
}

export interface Placed {
  start: number;
  end: number;
  mark: Mark;
  index: number;
}

/** Each mark at the first match of its quote that overlaps no mark placed before it; the rest are loose. */
export function anchorMarks(text: string, marks: Mark[]): { placed: Placed[]; loose: { mark: Mark; index: number }[] } {
  const placed: Placed[] = [];
  const loose: { mark: Mark; index: number }[] = [];
  marks.forEach((mark, index) => {
    let at = text.indexOf(mark.quote);
    while (at >= 0 && placed.some((p) => at < p.end && at + mark.quote.length > p.start)) at = text.indexOf(mark.quote, at + 1);
    if (at >= 0) placed.push({ start: at, end: at + mark.quote.length, mark, index });
    else loose.push({ mark, index });
  });
  return { placed: placed.sort((a, b) => a.start - b.start), loose };
}
