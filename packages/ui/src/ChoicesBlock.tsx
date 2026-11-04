import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { ChoiceOption } from "./client";
import { Option, OptionGroup } from "./guide/Option";

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
      <OptionGroup labelledBy={id}>
        {options.map((o, i) => (
          <Option
            key={i}
            checked={picked === i}
            // The option that moves along the path is the recommended one (UI refresh spec §5.1): options carry no kind.
            recommended={o.next}
            title={o.label}
            disabled={!active || picked !== null}
            onClick={() => {
              // Marked only once sent: a pick waiting for the go-ahead (or refused) leaves every option usable.
              if (choose(o)) setPicked(i);
            }}
          />
        ))}
      </OptionGroup>
    </section>
  );
}
