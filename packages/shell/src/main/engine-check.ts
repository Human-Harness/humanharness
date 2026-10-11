import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { EngineDef } from "@humanharness/engines";
import {
  AcpTransport,
  ClaudeCliTransport,
  type EngineError,
  type Event,
  type Transport,
  type TransportOptions,
} from "@humanharness/runtime";

export const TEST_PROMPT = "Reply with the single word OK.";
const TIMEOUT_MS = 90_000;

/**
 * Runs one tiny turn in an empty temporary folder: read-only, no MCP servers, nothing saved.
 * It proves the CLI starts, the user is signed in and the plan answers.
 */
export async function testPrompt(
  engine: EngineDef,
  cmd: { command: string[]; env: Record<string, string> },
  opts: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; error?: EngineError }> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "hh-check-"));
  const options: TransportOptions = {
    folder,
    session: { id: randomUUID(), started: false },
    mcp: [],
    permissions: { edit: "none", exec: false, web: false },
    sessionMode: engine.transport.kind === "acp" ? engine.transport.modes?.readOnly : undefined,
    minAdapterVersion: engine.transport.kind === "acp" ? engine.transport.minAdapterVersion : undefined,
    command: cmd.command,
    env: cmd.env,
    onSessionStarted: () => {},
  };
  const transport: Transport = engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(options) : new AcpTransport(options);
  const events: Event[] = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    await transport.turn(TEST_PROMPT, (e) => events.push(e), controller.signal);
  } finally {
    clearTimeout(timer);
    await transport.close().catch(() => undefined);
    await fs.rm(folder, { recursive: true, force: true });
  }
  const done = events.find((e): e is Extract<Event, { type: "done" }> => e.type === "done");
  if (done?.ok) return { ok: true };
  return { ok: false, error: done && !done.ok ? done.error : { code: "agent-crashed" } };
}
