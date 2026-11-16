import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../guide/Button";
import { type AppState, type TaskView, nextInPath } from "../client";

/**
 * Opens the left overlay (task view one column). In flow mode it says where the task is on the path ("Path · 1 / 6");
 * otherwise just the overlay's name.
 */
export function PathButton({
  state,
  tasks,
  name,
  expanded,
  controls,
  onClick,
  buttonRef,
}: {
  state: AppState;
  tasks: TaskView;
  name: string;
  expanded: boolean;
  controls?: string;
  onClick: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
}) {
  const { t } = useTranslation();
  const path = (state.path ?? []).filter((id) => state.actions[id]);
  const current = tasks.current ? tasks.current.action : (nextInPath(path, undefined, tasks.actions) ?? undefined);
  const at = current ? path.indexOf(current) + 1 : 0;
  const step = at > 0 ? at : path.filter((id) => tasks.actions[id] === "done").length;
  const label = path.length > 0 ? `${name} · ${t("flow.count", { done: step, total: path.length })}` : name;
  return (
    <Button ref={buttonRef} kind="quiet" size="compact" aria-expanded={expanded} {...(controls ? { "aria-controls": controls } : {})} onClick={onClick}>
      {label}
    </Button>
  );
}
