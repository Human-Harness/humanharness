import { useTranslation } from "react-i18next";
import type { AppState, TasksState } from "../client";
import { Tag } from "../chrome";
import { Tabs } from "../guide";

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
      <Tabs
        label={t("tasks.open")}
        value={task.id}
        items={tasks.tasks.map((s) => ({
          id: s.id,
          label: s.label,
          waiting: s.state === "waiting",
          ...(s.state === "waiting" ? { ariaLabel: t("tasks.tabWaiting", { title: s.label }) } : {}),
        }))}
        onChange={(id) => id !== task.id && onFocus(id)}
      />
      {phase && (
        <Tag tone="orange">
          <span dir="auto">{phase}</span>
        </Tag>
      )}
    </div>
  );
}
