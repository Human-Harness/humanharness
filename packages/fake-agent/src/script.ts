import { writeFileSync } from "node:fs";
import path from "node:path";

/** Calls a tool on one of the MCP servers the client configured. */
export interface McpStep {
  mcp: { server: string; tool: string; args: Record<string, unknown> };
}
export interface WriteStep {
  write: { path: string; content: string };
}
export interface SleepStep {
  sleep: number;
  /** fake-acp only: keep sleeping even after session/cancel. */
  ignoreCancel?: boolean;
}

export type ClaudeStep =
  | { line: unknown }
  | McpStep
  | WriteStep
  | SleepStep
  /** Starts a grandchild that ignores SIGTERM. */
  | { spawnStubborn: true }
  /** Writes `raw` to stdout verbatim (no newline added). */
  | { raw: string }
  /** Kills the fake-claude process with this signal. */
  | { signal: NodeJS.Signals }
  /** Answers a translation turn (spec §9): reads the prompt's `<batch>` and calls `save_translation` with a pseudo-translation. */
  | { pseudoTranslate: { prefix?: string; server?: string; breakKeys?: string[] } };

/** Script for fake-claude: printed lines, side effects, then exit. */
export interface ClaudeScript {
  steps: ClaudeStep[];
  /**
   * Per-prompt steps: the first entry whose `match` (a regular expression) matches the prompt read
   * from stdin runs instead of `steps`.
   */
  turns?: { match: string; steps: ClaudeStep[] }[];
  stderr?: string;
  exitCode?: number;
  /** Fail with this error result (exit 1) instead of running `steps`, but only when argv contains `--resume`. */
  failOnResume?: string;
  /** Models the "plan" doesn't include: a run with `--model <one of these>` answers like the real CLI does. */
  failModels?: string[];
}

export type AcpStep =
  /** A session/update; `sessionId` sends it for another session than the prompt's (default: the prompt's). */
  | { update: Record<string, unknown>; sessionId?: string }
  | { permission: { toolCall: Record<string, unknown>; _meta?: Record<string, unknown> } }
  | McpStep
  | WriteStep
  | SleepStep
  | { error: { code: number; message: string } }
  /** Writes `stderr` and exits the process (simulates an agent crash). */
  | { crash: { stderr: string; code?: number } }
  | { stop: "end_turn" | "cancelled" | "refusal" };

/** Script for fake-acp: one array of steps per prompt turn. */
export interface AcpScript {
  loadSession?: boolean;
  /** Returned as `usage` in every prompt response. */
  usage?: Record<string, number>;
  sessionId?: string;
  /** Reported as agentInfo.version at initialize. */
  agentVersion?: string;
  /** Make `session/load` fail with a generic (non-login) error. */
  failLoad?: boolean;
  /** Advertise `sessionCapabilities.close` and answer `session/close`. */
  closeSession?: boolean;
  /** Never answer `session/close` (an agent stuck on it). */
  hangClose?: boolean;
  /** Returned as `configOptions` by session/new and session/load (the models and efforts the agent offers). */
  configOptions?: unknown[];
  /** Returned as `models.currentModelId` by session/new and session/load (Codex: "<model>[<effort>]"). */
  currentModelId?: string;
  /** `session/set_config_option` fails (invalid params) for these values. */
  rejectConfigValues?: string[];
  /**
   * OpenCode: each model's variants. When set, an `effort` select (category thought_level) is offered
   * only for the current model when it has variants; its values are the variants plus "default".
   */
  variants?: Record<string, string[]>;
  /**
   * OpenCode: the session's running cost in USD after each prompt (indexed like `turns`), sent as one
   * `usage_update` at the prompt's end, never on session/load. Absent (or no entry for a turn) is a
   * model whose context limit OpenCode does not know: no `usage_update` at all.
   */
  costs?: number[];
  turns: AcpStep[][];
}

export function writeScript(dir: string, script: ClaudeScript | AcpScript): string {
  const file = path.join(dir, `script-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(script));
  return file;
}

/** stream-json lines for a session start plus one streamed text block. */
export function claudeTextLines(text: string, sessionId = "fake-session"): { line: unknown }[] {
  const event = (e: unknown) => ({ line: { type: "stream_event", parent_tool_use_id: null, session_id: sessionId, event: e } });
  return [
    { line: { type: "system", subtype: "init", session_id: sessionId } },
    event({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }),
    event({ type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }),
    event({ type: "content_block_stop", index: 0 }),
  ];
}

export function claudeResultLine(ok: boolean, result = "", sessionId = "fake-session"): { line: unknown } {
  return {
    line: ok
      ? { type: "result", subtype: "success", is_error: false, result, session_id: sessionId }
      : { type: "result", subtype: "error_during_execution", is_error: true, result, session_id: sessionId },
  };
}
