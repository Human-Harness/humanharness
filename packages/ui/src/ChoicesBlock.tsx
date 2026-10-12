import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChoiceOption } from "./client";

/** The options of a `choices` block, keeping only well-formed fields (the agent wrote them). */
export function readOptions(data: unknown): ChoiceOption[] {
  const raw = (data as { options?: unknown } | null | undefined)?.options;
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((o): ChoiceOption[] => {
    if (!o || typeof o !== "object") return [];
    const x = o as Record<string, unknown>;
    if (typeof x.label !== "string" || !x.label) return [];
    return [
      {
        label: x.label,
        ...(typeof x.followUp === "string" && x.followUp ? { followUp: x.followUp } : {}),
        ...(typeof x.action === "string" && x.action ? { action: x.action } : {}),
        ...(x.next === true ? { next: true as const } : {}),
      },
    ];
  });
}

/** The core `choices` block: how to continue. A pick goes to the app, which moves the task along. */
export function ChoicesBlock({ data, choose, active }: { data: unknown; choose: (option: ChoiceOption) => boolean; active: boolean }) {
  const { t } = useTranslation();
  const id = useId();
  const [picked, setPicked] = useState<number | null>(null);
  const options = readOptions(data);
  if (options.length === 0) return null;
  return (
    <section className="hh-choices">
      <h3 id={id}>{t("choices.title")}</h3>
      <div className="hh-choice-list" role="group" aria-labelledby={id}>
        {options.map((o, i) => (
          <button
            key={i}
            type="button"
            aria-pressed={picked === i}
            className={o.next ? "hh-choice next" : "hh-choice"}
            disabled={!active || picked !== null}
            onClick={() => {
              // Marked only once sent: a pick waiting for the go-ahead (or refused) leaves every option usable.
              if (choose(o)) setPicked(i);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </section>
  );
}
