import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** The task's own header (UI refresh spec §5.1): what moved out of the top bar, next to the work it is about. */
export function TaskHeader({
  title,
  subtitle,
  leading,
  meters,
  sidekick,
  chips,
  onHistory,
  onNewTask,
}: {
  title: string;
  subtitle?: string;
  /** Before the meters: the scope picker, for a harness with scopes. */
  leading?: ReactNode;
  meters?: ReactNode;
  sidekick?: ReactNode;
  chips?: ReactNode;
  onHistory: () => void;
  /** Board mode only (parallel spec §9.1): without it there is no New task (D0). */
  onNewTask?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <header className="hh-task-head">
      <div className="hh-task-head-text">
        <h1 className="hh-task-title" dir="auto">
          {title}
        </h1>
        {subtitle && <span className="hh-caption">{subtitle}</span>}
      </div>
      {leading}
      {meters}
      {sidekick}
      {chips}
      <button type="button" className="hh-pill" onClick={onHistory}>
        {t("history.title")}
      </button>
      {onNewTask && (
        <button type="button" className="hh-cta" onClick={onNewTask}>
          {t("task.header.new")}
        </button>
      )}
    </header>
  );
}
