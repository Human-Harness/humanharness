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
  acpFields,
} from "@humanharness/runtime";

export const TEST_PROMPT = "Reply with the single word OK.";
const TIMEOUT_MS = 90_000;
/** After stopping it, how long to wait for the CLI to exit (its transport escalates to SIGKILL after 3 s). */
const STOP_WAIT_MS = 4_000;

/**
 * Runs one tiny turn in an empty temporary folder: read-only, no MCP servers, no project files.
 * Claude runs with `--no-session-persistence`, so it keeps no transcript of it; an ACP engine may
 * keep its own session record, as it does for any session. It proves the CLI starts, the user is
 * signed in and the plan answers. The timeout covers start-up too.
 */
export async function testPrompt(
  engine: EngineDef,
  cmd: { command: string[]; env: Record<string, string> },
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; error?: EngineError }> {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), "hh-check-"));
  const options: TransportOptions = {
    folder,
    session: { id: randomUUID(), started: false },
    mcp: [],
    permissions: { edit: "none", exec: false, web: false },
    ...acpFields(engine, "none"),
    persistSession: false,
    command: cmd.command,
    env: cmd.env,
    onSessionStarted: () => {},
  };
  const transport: Transport = engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(options) : new AcpTransport(options);
  const events: Event[] = [];
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), opts.timeoutMs ?? TIMEOUT_MS);
  });
  let outcome: "done" | "timeout" | "aborted";
  let onAbort: (() => void) | undefined;
  const aborted = new Promise<"aborted">((resolve) => {
    onAbort = () => resolve("aborted");
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener("abort", onAbort, { once: true });
  });
  const turn = transport.turn(TEST_PROMPT, (e) => events.push(e), controller.signal).then(
    () => "done" as const,
    () => "done" as const,
  );
  try {
    // Race the whole turn (start-up included): a transport may not watch the signal while it starts.
    outcome = await Promise.race([turn, timedOut, aborted]);
  } finally {
    clearTimeout(timer);
    if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
    controller.abort();
    await transport.close().catch(() => undefined);
    // Wait (bounded) for the CLI to be gone, so quitting right after leaves no process behind.
    let stopTimer: NodeJS.Timeout | undefined;
    await Promise.race([turn, new Promise<void>((r) => (stopTimer = setTimeout(r, STOP_WAIT_MS)))]);
    clearTimeout(stopTimer);
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
  if (outcome === "aborted") return { ok: false, error: { code: "cancelled" } };
  if (outcome === "timeout") return { ok: false, error: { code: "agent-crashed", detail: "timed out" } };
  const done = events.find((e): e is Extract<Event, { type: "done" }> => e.type === "done");
  if (done?.ok) return { ok: true };
  return { ok: false, error: done && !done.ok ? done.error : { code: "agent-crashed" } };
}
