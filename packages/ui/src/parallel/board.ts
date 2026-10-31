import type { TagTone } from "../chrome";
import type { TaskSummary } from "../client";

export const WORKING: TaskSummary["state"][] = ["running", "closing", "checkpoint"];

export interface BoardColumn<T> {
  id: "waiting" | "working" | "queued" | "jobs";
  tone: TagTone;
  items: T[];
}

/** The Inbox's task groups, in the order both its list and its board show them. */
export function taskGroups<T extends { state: string }>(tasks: T[]): { waiting: T[]; working: T[]; queued: T[] } {
  return {
    // Main lists the tasks oldest first: the latest to wait comes first.
    waiting: tasks.filter((t) => t.state === "waiting").reverse(),
    working: tasks.filter((t) => WORKING.includes(t.state as never)),
    queued: tasks.filter((t) => t.state === "queued"),
  };
}

/** The Inbox board's columns (UI refresh spec §5.4), from the same task states the list uses. */
export function boardColumns<T extends { state: string }, J>({ tasks, jobs }: { tasks: T[]; jobs: J[] | null }): BoardColumn<T | J>[] {
  const { waiting, working, queued } = taskGroups(tasks);
  const cols: BoardColumn<T | J>[] = [
    { id: "waiting", tone: "orange", items: waiting },
    { id: "working", tone: "blue", items: working },
    { id: "queued", tone: "gray", items: queued },
  ];
  if (jobs) cols.push({ id: "jobs", tone: "violet", items: jobs });
  return cols;
}
