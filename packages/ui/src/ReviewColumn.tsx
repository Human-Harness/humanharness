import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { type AnswerPick, type Review, type ReviewComment, type Section, diagramOf, locate, sections } from "@humanharness/harness-sdk/review";

export interface ReviewColumnProps {
  review: Review;
  /** The document's source, for "lost" and the diagram note. */
  text: string;
  agent: string;
  /** Approved and unchanged: answers are locked (§5.4). */
  locked: boolean;
  /** The comment whose answer waits for the turn to end. */
  waiting: string | null;
  active: string | null;
  /** `scroll`: the card was clicked, so its mark comes into view (not on hover or focus). */
  onActive(id: string, scroll?: boolean): void;
  onAnswer(id: string, pick: AnswerPick): void;
  onEditDraft(id: string, text: string | null): void;
  onReopen(id: string): void;
}

/** The "Comments" column (§6.1): one card per comment or question, in the record's order. Text is never HTML. */
export function ReviewColumn(p: ReviewColumnProps) {
  const { t } = useTranslation();
  // Once per text: every card locates its anchor in the same sections.
  const secs = useMemo(() => sections(p.text), [p.text]);
  return (
    <section className="hh-review-column" aria-label={t("review.column")}>
      {p.locked && (
        <p className="hh-caption" role="note">
          {t("review.locked")}
        </p>
      )}
      {p.review.comments.map((c) => (
        <ReviewCard key={c.id} c={c} secs={secs} {...p} />
      ))}
    </section>
  );
}

function ReviewCard({ c, secs, text, agent, locked, waiting, active, onActive, onAnswer, onEditDraft, onReopen }: ReviewColumnProps & { c: ReviewComment; secs: Section[] }) {
  const { t } = useTranslation();
  const [other, setOther] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const where = locate(text, c.anchor, { secs });
  const diagram = where ? diagramOf(text, where.start) : null;
  const picked = c.answer && "option" in c.answer ? c.answer.option : c.answer ? -1 : null;
  const group = `hh-review-${c.id}`;
  const off = locked || waiting === c.id;
  return (
    <article
      className={`hh-review-card hh-review-${c.kind}${active === c.id ? " hh-review-card-active" : ""}`}
      data-comment={c.id}
      aria-label={c.kind === "question" ? `${t("review.question")}: ${c.text}` : c.text}
      onFocus={() => onActive(c.id)}
      onMouseEnter={() => onActive(c.id)}
      onClick={() => onActive(c.id, true)}
    >
      <header className="hh-review-card-head">
        <span>{c.author === "person" ? t("review.you") : agent}</span>
        {c.blocking && c.state !== "resolved" && <span className="hh-review-badge">{t("review.blocking")}</span>}
        <span className="hh-review-state">{t(`review.${c.state === "lost" ? "open" : c.state}`)}</span>
      </header>
      {!where && <p className="hh-warn">{t("review.lost")}</p>}
      {diagram !== null && <p className="hh-caption">{t("review.diagram", { heading: diagram })}</p>}
      <blockquote className="hh-review-quote">{c.anchor.quote}</blockquote>
      {editing === null ? (
        <p>{c.text}</p>
      ) : (
        <div className="hh-review-edit">
          <textarea aria-label={t("review.edit")} value={editing} maxLength={4000} onChange={(e) => setEditing(e.target.value)} />
          <button
            type="button"
            disabled={!editing.trim()}
            onClick={() => {
              onEditDraft(c.id, editing);
              setEditing(null);
            }}
          >
            {t("review.save")}
          </button>
          <button type="button" onClick={() => setEditing(null)}>
            {t("review.cancel")}
          </button>
        </div>
      )}
      {c.kind === "question" && c.options && (
        <fieldset className="hh-review-options" disabled={off} aria-label={c.text}>
          {c.options.map((o, i) => (
            <label key={i}>
              <input type="radio" name={group} checked={picked === i} disabled={off} onChange={() => onAnswer(c.id, i)} />
              {o.label}
            </label>
          ))}
          <label>
            <input type="radio" name={group} checked={picked === null} disabled={off} onChange={() => onAnswer(c.id, null)} />
            {t("review.noAnswer")}
          </label>
          {other === null ? (
            <button type="button" disabled={off} onClick={() => setOther(c.answer && "other" in c.answer ? c.answer.other : "")}>
              {t("review.other")}
            </button>
          ) : (
            <div className="hh-review-edit">
              <textarea aria-label={t("review.otherLabel")} value={other} maxLength={2000} onChange={(e) => setOther(e.target.value)} />
              <button
                type="button"
                disabled={!other.trim()}
                onClick={() => {
                  onAnswer(c.id, { other: other.trim() });
                  setOther(null);
                }}
              >
                {t("review.otherSave")}
              </button>
              <button type="button" onClick={() => setOther(null)}>
                {t("review.cancel")}
              </button>
            </div>
          )}
        </fieldset>
      )}
      {waiting === c.id && (
        <p className="hh-caption" role="status">
          {t("review.waiting")}
        </p>
      )}
      {c.unapplied && <p className="hh-caption">{t("review.unapplied")}</p>}
      {c.replies.length > 0 && (
        <ol className="hh-review-replies">
          {c.replies.map((r, i) => (
            <li key={i}>
              <strong>{r.author === "person" ? t("review.you") : agent}</strong> <span>{r.text}</span>
            </li>
          ))}
        </ol>
      )}
      {c.state === "draft" && editing === null && (
        <div className="hh-review-actions">
          <button type="button" onClick={() => setEditing(c.text)}>
            {t("review.edit")}
          </button>
          <button type="button" onClick={() => onEditDraft(c.id, null)}>
            {t("review.delete")}
          </button>
        </div>
      )}
      {c.state === "resolved" && (
        <button type="button" onClick={() => onReopen(c.id)}>
          {t("review.reopen")}
        </button>
      )}
    </article>
  );
}
