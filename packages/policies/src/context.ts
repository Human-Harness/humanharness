/** What a new session's first message holds after the brief (spec §7.1), in order. */
export type StartPart = "instructions" | "notes" | "app-notes" | "data" | "prepared" | "pins" | "material" | "linked";

/** What `start` needs to know about the new task. */
export interface TaskStart {
  scoped: boolean;
  action?: string;
  /** The manifest's material `budget.indexTokens` (harness-sdk default 600); absent without material. */
  materialIndexTokens?: number;
}

/** The parts of a new session's first message, in order, and each one's token budget (none: the part's own default). */
export interface StartPlan {
  parts: { part: StartPart; budgetTokens?: number }[];
}

/** Where the task's context stands before a follow-up turn. `used` and `cap` are absent before the first turn reports them. */
export interface TurnState {
  used?: number;
  cap?: number;
  checkpointed: boolean;
}

/** What ended the task's session: the task ended, the folder moved, or a stored task resumes. */
export type ContinuityEvent = "task-end" | "move" | "resume";
/** How the work goes on after a `ContinuityEvent`. One value today: a new session that starts from the notes. */
export type Continuity = "new-session-from-notes";

/** Decides what a new session starts with, when to checkpoint, and how work goes on (spec §7.1). Decides only: no I/O. */
export interface ContextPolicy {
  id: string;
  /** What a new session's first message carries after the brief, in order, and each part's token budget. */
  start(task: TaskStart): StartPlan;
  /** Before a follow-up turn (a phase change and a wrap-up included). */
  beforeFollowUp(state: TurnState): "go" | "checkpoint";
  /** How the work goes on after a task ends, a folder move, or a resume. */
  continuity(event: ContinuityEvent): Continuity;
}

/** Share of the task's cap at which the checkpoint runs (spec D4). */
export const CHECKPOINT_AT = 0.8;

/** How much the app-wide notes index may take in a scope's session (spec §3.3 "trimmed"). */
export const APP_INDEX_TOKENS = 500;

/** Today's rules: the parts in today's order, a checkpoint at 80% of the cap once per compaction, a new session from the notes. */
export const DefaultContextPolicy: ContextPolicy = {
  id: "default",
  start: (task) => ({
    parts: [
      { part: "instructions" },
      { part: "notes" },
      { part: "app-notes", budgetTokens: APP_INDEX_TOKENS },
      { part: "data" },
      { part: "prepared" },
      { part: "pins" },
      { part: "material", ...(task.materialIndexTokens !== undefined ? { budgetTokens: task.materialIndexTokens } : {}) },
      { part: "linked" },
    ],
  }),
  beforeFollowUp: (s) => (s.used !== undefined && s.cap !== undefined && !s.checkpointed && s.used >= CHECKPOINT_AT * s.cap ? "checkpoint" : "go"),
  continuity: () => "new-session-from-notes",
};
