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

/** Normalized events every transport emits. Each turn ends with exactly one `done`. */
export type Event =
  | { type: "text"; delta: string }
  | { type: "paragraph" }
  | { type: "activity"; id: string; kind: ActivityKind; detail: string; state: "start" | "end"; error?: boolean }
  | { type: "block"; name: string; data: unknown }
  | { type: "limits"; status: string; windows: LimitWindow[] }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      /** API-equivalent cost when the engine reports it. Not what the user pays. */
      costEquivalentUsd?: number;
      /** The model the engine says it ran (Claude: system/init; Codex: currentModelId without its effort). */
      model?: string;
    }
  /** Context in use after the turn, in tokens, and the window when the engine reports it (spec §6). */
  | { type: "context"; used: number; size?: number }
  /** The engine compacted the conversation during the turn. */
  | { type: "compaction" }
  | { type: "done"; ok: true }
  | { type: "done"; ok: false; error: EngineError };

export function fail(code: ErrorCode, detail?: string): Event {
  return { type: "done", ok: false, error: detail ? { code, detail } : { code } };
}
