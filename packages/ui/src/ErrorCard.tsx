import { useTranslation } from "react-i18next";
import type { EngineError, EngineProblem, LimitWindow } from "./client";
import { formatReset, resetWindow } from "./usage";

/** A turn error, or "notice" for an engine whose setup isn't finished. */
export type CardError = EngineError | { code: "notice"; detail?: string };

/** Errors the user fixes in Settings → Engine. */
const FIXABLE = new Set(["engine-not-installed", "session-expired", "outdated-version", "notice"]);

/** Whether the card for this error offers to fix it in Settings → Engine. */
export const isFixable = (error: CardError | undefined): boolean => error !== undefined && FIXABLE.has(error.code);

/** The card for an engine that can't run yet (the background check). */
export function problemError(problem: EngineProblem): CardError {
  if (problem === "not-installed") return { code: "engine-not-installed" };
  if (problem === "outdated") return { code: "outdated-version" };
  if (problem === "logged-out") return { code: "session-expired" };
  return { code: "notice" };
}

export function ErrorCard({
  error,
  engine,
  onRetry,
  onFix,
  limits = null,
}: {
  error: CardError;
  engine: string;
  onRetry?: () => void;
  /** Opens Settings → Engine, where the matching step fixes this error. */
  onFix?: () => void;
  limits?: LimitWindow[] | null;
}) {
  const { t, i18n } = useTranslation();
  const reset = error.code === "out-of-quota" ? resetWindow(limits) : undefined;
  return (
    <div className="hh-error" role="alert">
      <p>{t(`errors.${error.code}`, { engine, defaultValue: t("errors.agent-crashed", { engine }) })}</p>
      {reset && <p>{t("errors.resetsAt", { time: formatReset(reset.resetsAt, i18n.language) })}</p>}
      {onFix && FIXABLE.has(error.code) && (
        <button className="hh-primary" onClick={onFix}>
          {t(`errors.fix.${error.code}`, { engine })}
        </button>
      )}
      {onRetry && error.code !== "cancelled" && error.code !== "notice" && <button onClick={onRetry}>{t("errors.retry")}</button>}
    </div>
  );
}
