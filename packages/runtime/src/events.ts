export type ActivityKind = "read" | "edit" | "search" | "web" | "exec" | "other";

export type ErrorCode =
  | "engine-not-installed"
  | "session-expired"
  | "out-of-quota"
  | "agent-crashed"
  | "cancelled"
  | "outdated-version"
  /** The user hasn't accepted the engine's legal notice (at its current version) in this app. */
  | "notice-required"
  /** The plan doesn't include the model the task asked for (resources spec §5.3). */
  | "model-unavailable";

export interface EngineError {
  code: ErrorCode;
  detail?: string;
}

/** One plan-limit window as reported by the engine (e.g. Claude's five_hour / seven_day). */
export interface LimitWindow {
  kind: string;
  /** 0..1 share of the window already used. */
  utilization: number;
  /** ISO timestamp when the window resets. */
  resetsAt: string;
}

/** The longest edit path kept from an engine: longer names no real file, only a big string held in main. */
export const EDIT_PATH_MAX = 4096;

/**
 * A line the app adds to a task's chat in board mode, never an engine's: another task also changed these paths
 * (parallel spec §5.3; `other` names it, absent when it has ended; `paths` the first few, `more` the rest), or the
 * earlier engine session couldn't be loaded and a new one started (PT-S4).
 */
export type TaskNotice = { kind: "conflict"; paths: string[]; more?: number; other?: string; ended?: true } | { kind: "resume-failed" };

/** A Markdown file a turn added or changed (document-reader spec §5.1): what its card shows. */
export interface DocumentCard {
  /** Relative to the folder, forward slashes. */
  path: string;
  title: string;
  /** Front-matter `kind`, when there is one. */
  kind?: string;
  change: "new" | "updated";
  /** Words in the body; the window turns them into a reading time. */
  words: number;
}

/** One harness tool call as the chat's folded line shows it (tools spec §8.2). */
export interface ToolCallView {
  tool: string;
  caller: "ui" | "agent" | "pre" | "job";
  ok: boolean;
  ms: number;
  summary: string;
  error?: string;
  /** Cut at 2 KB each. */
  args: string;
  result?: string;
  accesses: { kind: "fetch" | "exec" | "data" | "files"; target: string; allowed: boolean }[];
  /** The tool's `ctx.log` lines, keys hidden; absent when it logged none. */
  logs?: { level: "info" | "warn" | "error"; message: string }[];
  at: string;
}

/** Normalized events every transport emits. Each turn ends with exactly one `done`. */
export type Event =
  | { type: "text"; delta: string }
  | { type: "paragraph" }
  /**
   * `paths`: what a read or search tool named (as the engine reported them, usually absolute), on the start event only.
   * `tool`: an MCP tool's server and name (never the core's `ui`), on the start event only. Both are for the task
   * manager's context record (context-panel spec §3.2); the window never gets them.
   * `edits`: the files an edit tool named (absolute or as the engine wrote them), on the start event only. For the
   * history's attribution (parallel spec §5.2); the window and the chat log never get them (shell `forWindow`).
   * Only a hint: an engine that writes through the shell names no file.
   */
  | {
      type: "activity";
      id: string;
      kind: ActivityKind;
      detail: string;
      state: "start" | "end";
      error?: boolean;
      paths?: string[];
      tool?: { server: string; name: string };
      edits?: string[];
    }
  /** `id`: set by the app on a block the person answers (input-blocks spec §4), never by an engine. */
  | { type: "block"; name: string; data: unknown; id?: string }
  | { type: "limits"; status: string; windows: LimitWindow[] }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      /** API-equivalent cost when the engine reports it. Not what the user pays. */
      costEquivalentUsd?: number;
      /** Real money the provider charged for this turn, in USD (OpenCode). Absent when the engine reports no cost. */
      costUsd?: number;
      /** The model the engine says it ran (Claude: system/init; Codex: currentModelId without its effort). */
      model?: string;
    }
  /** Context in use after the turn, in tokens, and the window when the engine reports it (spec §6). */
  | { type: "context"; used: number; size?: number }
  /** The engine compacted the conversation during the turn. */
  | { type: "compaction" }
  /** Board mode only, from the app (never a transport): a notice for the task's chat, shown as a system line (D0: none). */
  | { type: "task-notice"; notice: TaskNotice }
  /** The turn's added or changed `.md` files, sent right before a successful `done`. Never empty. */
  | { type: "documents"; documents: DocumentCard[] }
  /** From the app (never a transport), only for a harness with tools: one tool call of the task (tools spec §8.2). */
  | { type: "tool-call"; call: ToolCallView }
  | { type: "done"; ok: true }
  | { type: "done"; ok: false; error: EngineError };

export function fail(code: ErrorCode, detail?: string): Event {
  return { type: "done", ok: false, error: detail ? { code, detail } : { code } };
}
