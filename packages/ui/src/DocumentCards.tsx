import { useTranslation } from "react-i18next";
import { readingMinutes } from "@humanharness/harness-sdk/documents";
import type { DocumentCard } from "./client";

/** The `.md` files an answer's turn added or changed (document-reader spec §5.1). */
export function DocumentCards({ cards, missing, onOpen }: { cards: DocumentCard[]; missing: ReadonlySet<string>; onOpen: (card: DocumentCard) => void }) {
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
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
