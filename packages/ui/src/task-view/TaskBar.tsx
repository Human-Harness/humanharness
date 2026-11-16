import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { SidekickToggle } from "../chrome";

/** What the shell gives the chat for the bar: where it goes, and the parts only the shell knows. */
export interface TaskBarSlot {
  /** The top bar's slot (TopBar `slot`): the bar is drawn there. */
  el: HTMLElement;
  harness: string;
  /** A task is open: the whole bar. Otherwise only the scope picker, the chips and the Sidekick toggle. */
  open: boolean;
  onHome: () => void;
  /** The task's name as a menu of tasks (TaskSwitcher). */
  switcher: ReactNode;
}

/**
 * The one bar of an open task (task view one column), inside the top bar, from the left: the harness crumb, the task
 * switcher, the status, the Path button that opens the left overlay, the scope picker when declared, a spacer, the
 * context chip, the Sidekick toggle and the button that opens its overlay when declared. The bell, the avatar and the
 * test tag follow it, as the top bar's own trailing pieces. With no task open the top bar keeps its crumbs and Volver,
 * and the slot holds only the Path button, the scope picker and the Sidekick pieces. Plugin chips sit in a row above
 * the conversation.
 */
export function TaskBar({
  open,
  harness,
  onHome,
  switcher,
  working,
  scope,
  context,
  path,
  sidekickButton,
  sidekick,
}: Omit<TaskBarSlot, "el"> & {
  working: boolean | null;
  scope?: ReactNode;
  context?: ReactNode;
  /** The Path button (PathButton), when the task has a left overlay. */
  path?: ReactNode;
  /** The button that opens Sidekick's overlay (SidekickButton), when the harness has Sidekick. */
  sidekickButton?: ReactNode;
  sidekick?: { on: boolean; onToggle: () => void } | null | undefined;
}) {
  const { t } = useTranslation();
  const tail = (
    <>
      {!open && path}
      {!open && scope}
      {sidekick && (
        <SidekickToggle
          on={sidekick.on}
          label={t(sidekick.on ? "sidekick.toggleOn" : "sidekick.toggleOff")}
          onToggle={sidekick.onToggle}
        />
      )}
      {sidekickButton}
    </>
  );
  if (!open) return tail;
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
        <span className="hh-tb-status" role="status" data-working={working}>
          {t(working ? "home.status.working" : "home.status.waiting")}
        </span>
      )}
      {path}
      {scope}
      <span className="hh-spacer" />
      {context}
      {tail}
    </>
  );
}
