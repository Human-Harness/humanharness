import type { TaskSummary } from "../client";

export const WORKING: TaskSummary["state"][] = ["running", "closing", "checkpoint"];

/** The Inbox's task groups, in the order its page shows them. */
export function taskGroups<T extends { state: string }>(tasks: T[]): { waiting: T[]; working: T[]; queued: T[] } {
  return {
    // Main lists the tasks oldest first: the latest to wait comes first.
    waiting: tasks.filter((t) => t.state === "waiting").reverse(),
    working: tasks.filter((t) => WORKING.includes(t.state as never)),
    queued: tasks.filter((t) => t.state === "queued"),
  };
}
