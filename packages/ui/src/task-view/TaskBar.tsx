import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SidekickToggle } from "../chrome";

/** What the shell gives the chat for the bar: where it goes, and the parts only the shell knows. */
export interface TaskBarSlot {
  /** The top bar's slot (TopBar `slot`): the bar is drawn there. */
  el: HTMLElement;
  harness: string;
  onHome: () => void;
  /** The task's name as a menu of tasks (TaskSwitcher). */
  switcher: ReactNode;
}

/**
 * The one bar of an open task (task view one column), inside the top bar, from the left: the harness crumb, the task
 * switcher, the status, the scope picker when declared, a spacer, the context chip, plugin chips, the Sidekick toggle
 * when declared. The bell, the avatar and the test tag follow it, as the top bar's own trailing pieces.
 */
export function TaskBar({
  harness,
  onHome,
  switcher,
  working,
  scope,
  context,
  chips,
  sidekick,
}: Omit<TaskBarSlot, "el"> & {
  working: boolean | null;
  scope?: ReactNode;
  context?: ReactNode;
  chips?: ReactNode;
  sidekick?: { on: boolean; onToggle: () => void } | null | undefined;
}) {
  const { t } = useTranslation();
  return (
    <>
      <nav className="hh-crumbs" aria-label={t("app.breadcrumb")}>
        <button type="button" className="hh-crumb" dir="auto" onClick={onHome}>
          {harness}
        </button>
        <span aria-hidden="true" className="hh-crumb-sep">
          /
        </span>
        {switcher}
      </nav>
      {working !== null && (
        <span className="hh-tb-status" role="status">
          {t(working ? "home.status.working" : "home.status.waiting")}
        </span>
      )}
      {scope}
      <span className="hh-spacer" />
      {context}
      {chips}
      {sidekick && (
        <SidekickToggle
          on={sidekick.on}
          label={t(sidekick.on ? "sidekick.toggleOn" : "sidekick.toggleOff")}
          onToggle={sidekick.onToggle}
        />
      )}
    </>
  );
}
