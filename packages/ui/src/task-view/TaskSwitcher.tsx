import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { ActionOption, HarnessClient, TasksState } from "../client";
import { Icon, Rx } from "../guide";

/** How many ended tasks the switcher lists under the open ones. */
const RECENT = 5;

interface Recent {
  id: string;
  label: string;
}

/**
 * The task's name in the bar (task view one column): a menu with the open tasks, the recent ones (History's list) and
 * New task. An open task gets the focus; a recent one, ended, opens in History.
 */
export function TaskSwitcher({
  client,
  title,
  actions,
  tasks,
  onFocus,
  onRecent,
  onNewTask,
}: {
  client: HarnessClient;
  title: string;
  actions: Record<string, ActionOption>;
  /** Board mode's open tasks; null in plain mode (one task: the one on screen). */
  tasks: TasksState | null;
  onFocus: (id: string) => void;
  onRecent: (id: string) => void;
  /** Board mode only (parallel spec §9.1): without it there is no New task (D0). */
  onNewTask?: () => void;
}) {
  const { t } = useTranslation();
  const [recent, setRecent] = useState<Recent[] | null>(null);
  /** The menu's content mounts only while open: Radix's content needs the app's Theme, which some hosts lack until then. */
  const [shown, setShown] = useState(false);
  const open = tasks?.tasks ?? [];
  const openIds = new Set(open.map((s) => s.id));
  /** History is read each time the menu opens: a task that ended since shows. */
  const load = (on: boolean) => {
    setShown(on);
    if (!on) return;
    client.historyTasks().then(
      (groups) =>
        setRecent(
          groups
            .filter(
              (g): g is typeof g & { taskId: string } =>
                g.taskId !== null && !g.jobId && !openIds.has(g.taskId),
            )
            .slice(0, RECENT)
            .map((g) => ({
              id: g.taskId,
              label:
                g.noteTitle ??
                (g.actionId
                  ? (actions[g.actionId]?.label ?? g.actionId)
                  : t("history.question")),
            })),
        ),
      () => setRecent([]),
    );
  };
  return (
    <Rx.DropdownMenu.Root open={shown} onOpenChange={load}>
      <Rx.DropdownMenu.Trigger>
        <Rx.Button
          className="hh-tb-switch"
          variant="ghost"
          color="gray"
          size="2"
        >
          <span className="hh-tb-title" dir="auto">
            {title}
          </span>
          <Icon name="chevron" size={14} />
        </Rx.Button>
      </Rx.DropdownMenu.Trigger>
      {shown && (
        <Rx.DropdownMenu.Content align="start">
          <Rx.DropdownMenu.Label>{t("tasks.open")}</Rx.DropdownMenu.Label>
          {/* Plain mode has no task list: the one open task is the one on screen. */}
          {open.length === 0 && (
            <Rx.DropdownMenu.Item disabled>
              <span dir="auto">{title}</span>
            </Rx.DropdownMenu.Item>
          )}
          {open.map((s) => (
            <Rx.DropdownMenu.Item
              key={s.id}
              disabled={s.focused === true}
              {...(s.state === "waiting"
                ? { "aria-label": t("tasks.tabWaiting", { title: s.label }) }
                : {})}
              onSelect={() => onFocus(s.id)}
            >
              <span dir="auto">{s.label}</span>
            </Rx.DropdownMenu.Item>
          ))}
          {recent && recent.length > 0 && (
            <>
              <Rx.DropdownMenu.Separator />
              <Rx.DropdownMenu.Label>
                {t("home.status.inProgress")}
              </Rx.DropdownMenu.Label>
              {recent.map((r) => (
                <Rx.DropdownMenu.Item
                  key={r.id}
                  onSelect={() => onRecent(r.id)}
                >
                  <span dir="auto">{r.label}</span>
                </Rx.DropdownMenu.Item>
              ))}
            </>
          )}
          {onNewTask && (
            <>
              <Rx.DropdownMenu.Separator />
              <Rx.DropdownMenu.Item onSelect={onNewTask}>
                <Icon name="add" size={14} />
                {t("task.header.new")}
              </Rx.DropdownMenu.Item>
            </>
          )}
        </Rx.DropdownMenu.Content>
      )}
    </Rx.DropdownMenu.Root>
  );
}
