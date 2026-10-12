import { type BlockProps, useTranslation } from "@humanharness/cli/ui";

/** `show_example_card`: one idea as a card. The data comes from the AI: check its shape before showing it. */
export function ExampleCard({ data }: BlockProps) {
  const { t } = useTranslation("harness");
  if (typeof data?.title !== "string" || typeof data?.body !== "string") return null;
  return (
    <article className="example-card" aria-label={t("exampleCard")}>
      <span className="example-kicker">{t("exampleCard")}</span>
      <h3>{data.title}</h3>
      <p>{data.body}</p>
    </article>
  );
}
