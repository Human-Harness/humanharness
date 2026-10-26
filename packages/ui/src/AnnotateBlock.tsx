import { type ReactNode, useId } from "react";
import { useTranslation } from "react-i18next";
import { anchorMarks, answerText, readAnnotation } from "./annotate";
import { isSkipped } from "./input";
import type { BlockProps } from "./Message";

/**
 * The core `annotate` block (input-blocks spec §7): the person's own words with the agent's marks over them, and
 * every mark's note in a list each mark points to (aria-describedby). A mark whose quote isn't found is listed with
 * its quote; nothing is dropped.
 */
export function AnnotateBlock({ data, answerOf }: BlockProps) {
  const { t } = useTranslation();
  const id = useId();
  const note = readAnnotation(data);
  if (!note) return null;
  const answer = answerOf?.(note.ref) ?? null;
  const text = answer ? answerText(answer, note.field) : null;
  const { placed, loose } = text === null ? { placed: [], loose: note.marks.map((mark, index) => ({ mark, index })) } : anchorMarks(text, note.marks);
  const looseOnes = new Set(loose.map((l) => l.index));
  const noteId = (i: number) => `${id}-note-${i}`;
  const parts: ReactNode[] = [];
  if (text !== null) {
    let at = 0;
    for (const p of placed) {
      if (p.start > at) parts.push(text.slice(at, p.start));
      parts.push(
        <mark key={p.index} className={`hh-mark ${p.mark.kind}`} tabIndex={0} aria-describedby={noteId(p.index)} {...(p.mark.comment ? { "data-comment": p.mark.comment } : {})}>
          {text.slice(p.start, p.end)}
        </mark>,
      );
      at = p.end;
    }
    if (at < text.length) parts.push(text.slice(at));
  }
  return (
    <section className="hh-annotate" aria-labelledby={`${id}-title`}>
      <h3 id={`${id}-title`}>{t("annotate.title")}</h3>
      {text !== null ? (
        <blockquote className="hh-annotated">{parts}</blockquote>
      ) : (
        <p className="hh-caption">{t(!answer ? "annotate.noAnswer" : isSkipped(answer.value) ? "annotate.skipped" : "annotate.noText")}</p>
      )}
      <ol className="hh-annotate-notes">
        {note.marks.map((m, i) => (
          <li key={i} id={noteId(i)} className={`hh-mark-note ${m.kind}`}>
            <strong>{t(`annotate.kind.${m.kind}`)}</strong>
            {looseOnes.has(i) && (
              <>
                {" "}
                <q>{m.quote}</q>
              </>
            )}
            {m.comment && ` ${m.comment}`}
          </li>
        ))}
      </ol>
    </section>
  );
}
