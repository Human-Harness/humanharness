import type { BlockProps } from "@humanharness/ui";
import { useTranslation } from "react-i18next";

export function NoteCard({ data }: BlockProps) {
  const { t } = useTranslation("harness");
  return (
    <section className="demo-note" aria-label={t("noteTitle")}>
      <h3>{data.title}</h3>
      <p style={{ whiteSpace: "pre-wrap" }}>{data.body}</p>
    </section>
  );
}
