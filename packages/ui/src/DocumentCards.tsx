import { useTranslation } from "react-i18next";
import { readingMinutes } from "@humanharness/harness-sdk/documents";
import type { DocumentCard, ReviewSummary } from "./client";

/**
 * The `.md` files an answer's turn added or changed (document-reader spec §5.1). `reviews` (only when the harness can
 * review) adds each document's review chip (review spec §6.1); absent, the cards are as before (D0).
 */
export function DocumentCards({
  cards,
  missing,
  onOpen,
  reviews,
}: {
  cards: DocumentCard[];
  missing: ReadonlySet<string>;
  onOpen: (card: DocumentCard) => void;
  reviews?: ReadonlyMap<string, ReviewSummary | null>;
}) {
  const { t } = useTranslation();
  return (
    <ul className="hh-doc-cards" aria-label={t("reader.cards")}>
      {cards.map((c) => {
        const gone = missing.has(c.path);
        return (
          <li key={c.path}>
            <button
              type="button"
              className={gone ? "hh-doc-card hh-doc-card-missing" : "hh-doc-card"}
              aria-disabled={gone || undefined}
              title={gone ? t("reader.moved") : c.path}
              onClick={() => {
                if (!gone) onOpen(c);
              }}
            >
              <span className="hh-doc-card-title">{c.title}</span>
              <span className="hh-doc-card-meta">
                {c.kind && <span className="hh-reader-chip">{c.kind}</span>}
                <span>{t(c.change === "new" ? "reader.new" : "reader.updated")}</span>
                <span>{t("reader.minutes", { count: readingMinutes(c.words) })}</span>
                {reviews && <ReviewChip summary={reviews.get(c.path) ?? null} />}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** A document's review state in one or two chips; nothing for a document with no review. */
function ReviewChip({ summary }: { summary: ReviewSummary | null }) {
  const { t } = useTranslation();
  if (!summary || summary.status === "none") return null;
  if (summary.status === "approved") return <span className="hh-review-chip hh-review-chip-ok">{t("review.chipApproved")}</span>;
  if (summary.status === "stale") return <span className="hh-review-chip hh-review-chip-warn">{t("review.chipStale")}</span>;
  return (
    <>
      <span className="hh-review-chip">{summary.questions > 0 ? t("review.chipQuestions", { count: summary.questions }) : t("review.chipDraft")}</span>
      {summary.blocking > 0 && <span className="hh-review-chip hh-review-chip-warn">{t("review.chipBlocking", { count: summary.blocking })}</span>}
    </>
  );
}
