import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModelProfile } from "@humanharness/engines";
import { BLOCK_ID } from "@humanharness/harness-sdk";
import type { Session } from "@humanharness/runtime";
import type { ActionStatus, TaskStatus } from "@humanharness/ui/client";
import { MAIN_SCOPE, isScopeDir, isScopeId, tasksFile } from "@humanharness/workspace";
import { cleanProfile } from "./models";

/** The input block the task waits an answer for (input-blocks spec §4): its id, its block's name, when it was shown. */
export interface PendingInput {
  blockId: string;
  block: string;
  shownAt: string;
}

/** The task in progress: one engine session from its first turn to its note. */
export interface CurrentTask {
  id: string;
  /** The manifest action; absent for a free question. */
  action?: string;
  /** The question that started a free-question task, whole up to QUESTION_MAX characters. */
  question?: string;
  /** The question was longer than QUESTION_MAX and was cut: a resumed session is told so. */
  questionCut?: boolean;
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
  /** `turns` when the last checkpoint note was written: a turn after it isn't in that note. */
  checkpointTurns?: number;
  /** The engine session was lost (the folder moved): the next turn starts a new one from the notes. */
  resume?: boolean;
  /** The scope the task runs in (`_app` for app-wide work). Absent in a harness without scopes (spec D2). */
  scope?: string;
  /** The question the task waits on: the last input block shown (spec D5). Absent in a harness with none (D0). */
  pendingInput?: PendingInput;
}

/** `<folder>/.harness/tasks.json`: the current task and how each action ended. Replaces the runtime's session.json. */
export interface TasksFile {
  version: 1;
  /** The engine that ran the last task. */
  engine?: string;
  current: CurrentTask | null;
  /** How each action ended in `main`: every action of a harness without scopes (spec D2). */
  actions: Record<string, ActionStatus>;
  /** Harnesses with scopes: the open scope; absent when none is open. */
  open?: string;
  /** Harnesses with scopes: how each action ended in every scope other than `main` (`_app` included). */
  scopes?: Record<string, Record<string, ActionStatus>>;
}

export const emptyTasks = (): TasksFile => ({ version: 1, current: null, actions: {} });

/** How much of a free question tasks.json keeps (a resumed session gets it back): generous, but bounded. */
export const QUESTION_MAX = 20_000;

/** The question as tasks.json keeps it: whole up to QUESTION_MAX, otherwise cut and marked. */
export function keptQuestion(text: string): { question: string; questionCut?: true } {
  return text.length > QUESTION_MAX ? { question: text.slice(0, QUESTION_MAX), questionCut: true } : { question: text };
}

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

const BLOCK_NAME = /^[a-z][a-z0-9_]*$/;

function cleanPending(p: unknown): PendingInput | undefined {
  if (!isObject(p) || typeof p.blockId !== "string" || !BLOCK_ID.test(p.blockId)) return undefined;
  if (typeof p.block !== "string" || !BLOCK_NAME.test(p.block) || typeof p.shownAt !== "string") return undefined;
  return { blockId: p.blockId, block: p.block, shownAt: p.shownAt };
}

/** Built field by field: nothing from the file reaches the engine unchecked. */
function cleanCurrent(c: unknown): CurrentTask | null {
  if (!isObject(c) || typeof c.id !== "string" || !TASK_STATUSES.includes(c.status as string)) return null;
  const session = cleanSession(c.session);
  const profile = cleanProfile(c.profile);
  const pending = cleanPending(c.pendingInput);
  const tokens = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
  const ctx = isObject(c.context) && tokens(c.context.used) ? { used: c.context.used, ...(tokens(c.context.size) ? { size: c.context.size } : {}) } : undefined;
  return {
    id: c.id,
    ...(typeof c.action === "string" ? { action: c.action } : {}),
    ...(typeof c.question === "string" ? keptQuestion(c.question) : {}),
    ...(c.questionCut === true && typeof c.question === "string" ? { questionCut: true } : {}),
    status: c.status as TaskStatus,
    ...(session ? { session } : {}),
    startedAt: typeof c.startedAt === "string" ? c.startedAt : "",
    turns: typeof c.turns === "number" && Number.isFinite(c.turns) ? c.turns : 0,
    ...(typeof c.noteSaved === "boolean" ? { noteSaved: c.noteSaved } : {}),
    ...(profile ? { profile } : {}),
    ...(ctx ? { context: ctx } : {}),
    ...(typeof c.checkpointed === "boolean" ? { checkpointed: c.checkpointed } : {}),
    ...(typeof c.checkpointNote === "boolean" ? { checkpointNote: c.checkpointNote } : {}),
    ...(typeof c.checkpointTurns === "number" && Number.isFinite(c.checkpointTurns) ? { checkpointTurns: c.checkpointTurns } : {}),
    ...(c.resume === true ? { resume: true } : {}),
    ...(isScopeDir(c.scope) ? { scope: c.scope } : {}),
    ...(pending ? { pendingInput: pending } : {}),
  };
}

function statuses(raw: unknown): Record<string, ActionStatus> {
  const out: Record<string, ActionStatus> = {};
  if (isObject(raw)) {
    for (const [id, status] of Object.entries(raw)) {
      if (typeof status === "string" && ACTION_STATUSES.includes(status)) out[id] = status as ActionStatus;
    }
  }
  return out;
}

/** Keeps what has the right shape; anything else reads as "nothing". */
function clean(raw: unknown): TasksFile {
  if (!isObject(raw) || raw.version !== 1) return emptyTasks();
  let scopes: Record<string, Record<string, ActionStatus>> | undefined;
  if (isObject(raw.scopes)) {
    scopes = {};
    for (const [id, v] of Object.entries(raw.scopes)) if (isScopeDir(id) && id !== MAIN_SCOPE) scopes[id] = statuses(v);
  }
  return {
    version: 1,
    ...(typeof raw.engine === "string" ? { engine: raw.engine } : {}),
    current: cleanCurrent(raw.current),
    actions: statuses(raw.actions),
    ...(isScopeId(raw.open) ? { open: raw.open } : {}),
    ...(scopes ? { scopes } : {}),
  };
}

/** The scope a task runs in: `main` when it has none (a harness without scopes). */
export const scopeOfTask = (c: Pick<CurrentTask, "scope">): string => c.scope ?? MAIN_SCOPE;

/** How each action ended in `scope`; `main`'s are the `actions` field. */
export function statusesIn(s: TasksFile, scope: string): Record<string, ActionStatus> {
  return scope === MAIN_SCOPE ? s.actions : (s.scopes?.[scope] ?? {});
}

/** `s` with `action` marked `status` in `scope`. */
export function withStatus(s: TasksFile, scope: string, action: string, status: ActionStatus): TasksFile {
  if (scope === MAIN_SCOPE) return { ...s, actions: { ...s.actions, [action]: status } };
  return { ...s, scopes: { ...s.scopes, [scope]: { ...statusesIn(s, scope), [action]: status } } };
}

/**
 * The open task ends without a note: its action gets `outcome` (unfinished by default), unless the task
 * saved its note anyway (a checkpoint's note counts) or an earlier task already got it done.
 */
export function interrupted(state: TasksFile, outcome: ActionStatus = "unfinished"): TasksFile {
  const c = state.current;
  if (!c) return state;
  if (!c.action) return { ...state, current: null };
  const scope = scopeOfTask(c);
  const status: ActionStatus = c.noteSaved || c.checkpointNote || statusesIn(state, scope)[c.action] === "done" ? "done" : outcome;
  return { ...withStatus(state, scope, c.action, status), current: null };
}

export class TaskStore {
  readonly file: string;

  constructor(folder: string) {
    this.file = tasksFile(folder);
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
