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
  | { signal: NodeJS.Signals };

/** Script for fake-claude: printed lines, side effects, then exit. */
export interface ClaudeScript {
  steps: ClaudeStep[];
  stderr?: string;
  exitCode?: number;
}

export type AcpStep =
  | { update: Record<string, unknown> }
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
