import { useTranslation } from "react-i18next";
import type { AppState, TasksState } from "../client";

/**
 * Board mode (parallel spec §9.1): a thin bar over the chat naming the task it shows, its phase, and "New task" for the
 * start view. Nothing when no open task has the focus (the start view itself).
 */
export function TaskStrip({ state, tasks, onNewTask }: { state: AppState; tasks: TasksState | null; onNewTask: () => void }) {
  const { t } = useTranslation();
  const task = tasks?.tasks.find((s) => s.focused);
  if (!task) return null;
  const action = task.action && Object.hasOwn(state.actions, task.action) ? state.actions[task.action] : null;
  const phase = task.phase ? (action?.phases?.find((p) => p.id === task.phase)?.label ?? null) : null;
  return (
    <div className="hh-tk-strip" role="group" aria-label={t("parallel.shownTask")}>
      <span className="hh-tk-label" dir="auto">
        {task.label}
      </span>
      {phase && (
        <span className="hh-caption" dir="auto">
          {phase}
        </span>
      )}
      <button type="button" onClick={onNewTask}>
        {t("parallel.newTask")}
      </button>
    </div>
  );
}
