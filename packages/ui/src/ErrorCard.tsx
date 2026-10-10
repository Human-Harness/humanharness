import { useTranslation } from "react-i18next";
import type { EngineError } from "./client";

export function ErrorCard({ error, engine, onRetry }: { error: EngineError; engine: string; onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="hh-error" role="alert">
      <p>{t(`errors.${error.code}`, { engine, defaultValue: t("errors.agent-crashed", { engine }) })}</p>
      {onRetry && error.code !== "cancelled" && <button onClick={onRetry}>{t("errors.retry")}</button>}
    </div>
  );
}
