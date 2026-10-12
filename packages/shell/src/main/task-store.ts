import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Session } from "@humanharness/runtime";
import type { ActionStatus, TaskStatus } from "@humanharness/ui/client";

/** The task in progress: one engine session from its first turn to its note. */
export interface CurrentTask {
  id: string;
  /** The manifest action; absent for a free question. */
  action?: string;
  /** The question that started a free-question task. */
  question?: string;
  status: TaskStatus;
  /** The engine session, once the engine started it. */
  session?: Session;
  startedAt: string;
  /** Turns finished so far. */
  turns: number;
  /** The agent's note for this task was written. */
  noteSaved?: boolean;
}

/** `<folder>/.harness/tasks.json`: the current task and how each action ended. Replaces the runtime's session.json. */
export interface TasksFile {
  version: 1;
  /** The engine that ran the last task. */
  engine?: string;
  current: CurrentTask | null;
  actions: Record<string, ActionStatus>;
}

export const emptyTasks = (): TasksFile => ({ version: 1, current: null, actions: {} });

const ACTION_STATUSES: readonly string[] = ["done", "unsaved", "unfinished"];
const TASK_STATUSES: readonly string[] = ["running", "waiting", "closing"];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Keeps what has the right shape; anything else reads as "nothing". */
function clean(raw: unknown): TasksFile {
  if (!isObject(raw) || raw.version !== 1) return emptyTasks();
  const actions: Record<string, ActionStatus> = {};
  if (isObject(raw.actions)) {
    for (const [id, status] of Object.entries(raw.actions)) if (ACTION_STATUSES.includes(status as string)) actions[id] = status as ActionStatus;
  }
  const c = raw.current;
  const current =
    isObject(c) && typeof c.id === "string" && TASK_STATUSES.includes(c.status as string)
      ? ({ ...c, turns: typeof c.turns === "number" ? c.turns : 0 } as unknown as CurrentTask)
      : null;
  return { version: 1, ...(typeof raw.engine === "string" ? { engine: raw.engine } : {}), current, actions };
}

/** The open task ends without a note: its action is unfinished, unless an earlier task already got it done. */
export function interrupted(state: TasksFile): TasksFile {
  const c = state.current;
  if (!c) return state;
  if (!c.action) return { ...state, current: null };
  const status: ActionStatus = c.noteSaved || state.actions[c.action] === "done" ? "done" : "unfinished";
  return { ...state, current: null, actions: { ...state.actions, [c.action]: status } };
}

export class TaskStore {
  readonly file: string;

  constructor(folder: string) {
    this.file = path.join(folder, ".harness", "tasks.json");
  }

  async load(): Promise<TasksFile> {
    try {
      return clean(JSON.parse(await fs.readFile(this.file, "utf8")));
    } catch {
      return emptyTasks();
    }
  }

  /** Atomic: temp file + rename. */
  async save(state: TasksFile): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify(state, null, 2));
      await fs.rename(tmp, this.file);
    } catch (err) {
      await fs.rm(tmp, { force: true });
      throw err;
    }
  }

  /** After an engine change: the open task ends (its session belongs to the old engine) and the file no longer names that engine. */
  async forgetEngine(): Promise<void> {
    const { engine: _old, ...rest } = interrupted(await this.load());
    await this.save(rest);
  }
}
