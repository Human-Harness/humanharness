import { useTranslation } from "react-i18next";
import type { EngineOption, LimitWindow } from "./client";
import { HIGH_AT, WARN_AT, compactTokens, formatReset, percent } from "./usage";

/** Where the user stands on their plan (spec §6), in one line: only what the engine reports. */
export function UsageMeter({ engine, limits, lastTokens }: { engine?: EngineOption; limits: LimitWindow[] | null; lastTokens: number | null }) {
  const { t, i18n } = useTranslation();
  if (!engine) return null;
  if (!engine.reportsLimits) {
    const tokens = lastTokens !== null ? ` ${t("usage.lastTurn", { tokens: compactTokens(lastTokens, i18n.language) })}` : "";
    return <p className="hh-usage">{t("usage.noLimits", { engine: engine.name }) + tokens}</p>;
  }
  if (!limits?.length) return <p className="hh-usage">{t("usage.unknown")}</p>;
  const text = limits
    .map((w) => {
      const part = t("usage.window", { label: t(`usage.${w.kind}`, { defaultValue: w.kind }), percent: percent(w.utilization) });
      return w.kind === "five_hour" ? `${part} · ${t("usage.resets", { time: formatReset(w.resetsAt, i18n.language) })}` : part;
    })
    .join(" — ");
  const highest = Math.max(...limits.map((w) => w.utilization));
  const warning = highest >= HIGH_AT ? t("usage.almostOut") : highest >= WARN_AT ? t("usage.near") : null;
  return (
    <p className={warning ? "hh-usage hh-warn" : "hh-usage"}>
      {warning && <strong>{warning} · </strong>}
      {text}
    </p>
  );
}
