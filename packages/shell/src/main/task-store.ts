import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModelProfile } from "@humanharness/engines";
import type { Session } from "@humanharness/runtime";
import type { ActionStatus, TaskStatus } from "@humanharness/ui/client";
import { cleanProfile } from "./models";

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
  /** The model, effort and cap the task runs on, resolved when it started (resources spec §5). */
  profile?: ModelProfile;
  /** Context in use by the task's session after its last turn, and the window when the engine said. */
  context?: { used: number; size?: number };
  /** A checkpoint ran since the last compaction (spec §6). */
  checkpointed?: boolean;
  /** A checkpoint wrote this task's note; the closing turn still updates it. */
  checkpointNote?: boolean;
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
const TASK_STATUSES: readonly string[] = ["running", "waiting", "closing", "checkpoint"];
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * An engine session id: UUIDs (Claude, Codex, Gemini) and the fake agent's `fake-acp-session-2`.
 * Never a leading `-` or whitespace, so it can't read as a CLI flag.
 */
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/;

function cleanSession(s: unknown): Session | undefined {
  if (!isObject(s) || typeof s.id !== "string" || !SESSION_ID.test(s.id) || typeof s.started !== "boolean") return undefined;
  return { id: s.id, started: s.started };
}

/** Built field by field: nothing from the file reaches the engine unchecked. */
function cleanCurrent(c: unknown): CurrentTask | null {
  if (!isObject(c) || typeof c.id !== "string" || !TASK_STATUSES.includes(c.status as string)) return null;
  const session = cleanSession(c.session);
  const profile = cleanProfile(c.profile);
  const tokens = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const ctx = isObject(c.context) && tokens(c.context.used) ? { used: c.context.used, ...(tokens(c.context.size) ? { size: c.context.size } : {}) } : undefined;
  return {
    id: c.id,
    ...(typeof c.action === "string" ? { action: c.action } : {}),
    ...(typeof c.question === "string" ? { question: c.question } : {}),
    status: c.status as TaskStatus,
    ...(session ? { session } : {}),
    startedAt: typeof c.startedAt === "string" ? c.startedAt : "",
    turns: typeof c.turns === "number" && Number.isFinite(c.turns) ? c.turns : 0,
    ...(typeof c.noteSaved === "boolean" ? { noteSaved: c.noteSaved } : {}),
    ...(profile ? { profile } : {}),
    ...(ctx ? { context: ctx } : {}),
    ...(typeof c.checkpointed === "boolean" ? { checkpointed: c.checkpointed } : {}),
    ...(typeof c.checkpointNote === "boolean" ? { checkpointNote: c.checkpointNote } : {}),
  };
}

/** Keeps what has the right shape; anything else reads as "nothing". */
function clean(raw: unknown): TasksFile {
  if (!isObject(raw) || raw.version !== 1) return emptyTasks();
  const actions: Record<string, ActionStatus> = {};
  if (isObject(raw.actions)) {
    for (const [id, status] of Object.entries(raw.actions)) {
      if (typeof status === "string" && ACTION_STATUSES.includes(status)) actions[id] = status as ActionStatus;
    }
  }
  const current = cleanCurrent(raw.current);
  return { version: 1, ...(typeof raw.engine === "string" ? { engine: raw.engine } : {}), current, actions };
}

/**
 * The open task ends without a note: its action gets `outcome` (unfinished by default), unless the task
 * saved its note anyway or an earlier task already got it done.
 */
export function interrupted(state: TasksFile, outcome: ActionStatus = "unfinished"): TasksFile {
  const c = state.current;
  if (!c) return state;
  if (!c.action) return { ...state, current: null };
  const status: ActionStatus = c.noteSaved || state.actions[c.action] === "done" ? "done" : outcome;
  return { ...state, current: null, actions: { ...state.actions, [c.action]: status } };
}

export class TaskStore {
  readonly file: string;

  constructor(folder: string) {
    this.file = path.join(folder, ".harness", "tasks.json");
  }

  /** A missing file reads as empty; one that isn't JSON is set aside as `tasks.json.corrupt-<time>`; other errors are thrown. */
  async load(): Promise<TasksFile> {
    let text: string;
    try {
      text = await fs.readFile(this.file, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return emptyTasks();
      throw err;
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      await fs.rename(this.file, `${this.file}.corrupt-${Date.now()}`);
      return emptyTasks();
    }
    return clean(raw);
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
