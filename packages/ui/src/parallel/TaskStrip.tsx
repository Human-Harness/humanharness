import { useTranslation } from "react-i18next";
import type { AppState, TasksState } from "../client";
import { Tag } from "../chrome";

/**
 * Board mode (parallel spec §9.1, UI refresh spec §5.1): a row of tabs over the chat, one per open task, the one on
 * screen selected and a task waiting for you with a dot, and the shown task's phase. "New task" lives in the task
 * header only.
 * A tab asks main for the focus; the chat follows main's tasks change, as with an inbox row. Nothing when no open task
 * has the focus (the start view itself).
 */
export function TaskStrip({
  state,
  tasks,
  onFocus,
}: {
  state: AppState;
  tasks: TasksState | null;
  onFocus: (id: string) => void;
}) {
  const { t } = useTranslation();
  const task = tasks?.tasks.find((s) => s.focused);
  if (!tasks || !task) return null;
  const action = task.action && Object.hasOwn(state.actions, task.action) ? state.actions[task.action] : null;
  const phase = task.phase ? (action?.phases?.find((p) => p.id === task.phase)?.label ?? null) : null;
  return (
    <div className="hh-tk-strip" role="group" aria-label={t("parallel.shownTask")}>
      <div className="hh-tk-tabs" role="tablist" aria-label={t("tasks.open")}>
        {tasks.tasks.map((s) => {
          const waiting = s.state === "waiting";
          return (
            <button
              key={s.id}
              type="button"
              role="tab"
              className="hh-tk-tab"
              aria-selected={s.focused === true}
              aria-label={waiting ? t("tasks.tabWaiting", { title: s.label }) : s.label}
              onClick={s.focused ? undefined : () => onFocus(s.id)}
            >
              {waiting && <span className="hh-tk-dot" aria-hidden="true" />}
              <span className="hh-tk-label" dir="auto">
                {s.label}
              </span>
            </button>
          );
        })}
      </div>
      {phase && (
        <Tag tone="orange">
          <span dir="auto">{phase}</span>
        </Tag>
      )}
    </div>
  );
}
