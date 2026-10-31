import type { TagTone } from "../chrome";
import { WORKING } from "./Inbox";

export interface BoardColumn<T> {
  id: "waiting" | "working" | "queued" | "jobs";
  tone: TagTone;
  items: T[];
}

/** The Inbox board's columns (UI refresh spec §5.4), from the same task states the list uses. */
export function boardColumns<T extends { state: string }, J>({ tasks, jobs }: { tasks: T[]; jobs: J[] | null }): BoardColumn<T | J>[] {
  const cols: BoardColumn<T | J>[] = [
    { id: "waiting", tone: "orange", items: tasks.filter((t) => t.state === "waiting") },
    { id: "working", tone: "blue", items: tasks.filter((t) => WORKING.includes(t.state as never)) },
    { id: "queued", tone: "gray", items: tasks.filter((t) => t.state === "queued") },
  ];
  if (jobs) cols.push({ id: "jobs", tone: "violet", items: jobs });
  return cols;
}
