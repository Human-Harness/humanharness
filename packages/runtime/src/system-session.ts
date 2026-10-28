import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type McpServerSpec, openRpc } from "@humanharness/blocks";
import type { EngineDef, ModelProfile } from "@humanharness/engines";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import type { EngineError, Event } from "./events";
import type { SystemTaskResult } from "./system";
import { type Transport, type TransportOptions, acpFields } from "./transport";

export interface SystemSessionOptions {
  engine: EngineDef;
  /** The engine's CLI (from `engineCommand`, or a fake one in tests). */
  command: string[];
  env?: Record<string, string>;
  /** The session's only MCP server, given the app's RPC channel. */
  server: (rpc: { path: string; token: string }) => McpServerSpec;
  /** Answers the server's calls; a throw is a refusal the AI reads. */
  handle: (request: unknown) => Promise<unknown>;
  /** Where the empty working folder is made (created if missing); the folder is removed afterwards. */
  parent: string;
  /** The prompt of turn `turn` (0-based), or null when there is nothing more to ask. */
  next: (turn: number) => Promise<string | null>;
  /** After each turn, with what it reported. Awaited before the next prompt is asked. */
  onTurn?: (result: SystemTaskResult, turn: number) => Promise<void>;
  profile?: ModelProfile;
  signal?: AbortSignal;
  /** Longest a single turn may run; then it is stopped and counts as failed. */
  turnTimeoutMs?: number;
  maxTurns?: number;
}

export interface SystemSessionResult {
  ok: boolean;
  /** Turns that ran (failed ones included). */
  turns: number;
  error?: EngineError;
}

const TURN_TIMEOUT_MS = 4 * 60_000;
const MAX_TURNS = 60;

const crashed = (err: unknown): EngineError => ({ code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) });

/**
 * One engine session outside any task (language spec §5): an empty folder under `parent`, one MCP server, no edits, no
 * web, no commands; one turn per prompt, resumed in the same session. Unlike `runSystemTask` the session is saved,
 * because Claude resumes it from its own store; the app never reads that store. Stops at the first failed turn, a stop
 * (`signal`) or `maxTurns`. Never throws.
 */
export async function runSystemSession(o: SystemSessionOptions): Promise<SystemSessionResult> {
  if (o.signal?.aborted) return { ok: false, turns: 0, error: { code: "cancelled" } };
  let folder: string;
  try {
    await fs.mkdir(o.parent, { recursive: true });
    folder = await fs.mkdtemp(path.join(o.parent, "run-"));
  } catch (err) {
    return { ok: false, turns: 0, error: crashed(err) };
  }
  const rpc = await openRpc(o.handle).catch(() => null);
  if (!rpc) {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, turns: 0, error: { code: "agent-crashed", detail: "rpc" } };
  }
  let transport: Transport | undefined;
  let turns = 0;
  let error: EngineError | undefined;
  try {
    const options: TransportOptions = {
      folder,
      session: { id: randomUUID(), started: false },
      mcp: [o.server({ path: rpc.path, token: rpc.token })],
      permissions: { edit: "none", exec: false, web: false },
      ...acpFields(o.engine, "none"),
      // Turns resume the same session (Claude needs it on disk); the app never reads the engine's own store.
      persistSession: true,
      command: o.command,
      ...(o.env ? { env: o.env } : {}),
      onSessionStarted: () => {},
    };
    transport = o.engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(options) : new AcpTransport(options);
    for (let i = 0; i < (o.maxTurns ?? MAX_TURNS); i++) {
      if (o.signal?.aborted) {
        error = { code: "cancelled" };
        break;
      }
      const prompt = await o.next(i);
      if (prompt === null) break;
      const r = await oneTurn(transport, prompt, o);
      turns++;
      await o.onTurn?.(r, i);
      if (!r.ok) {
        error = r.error ?? { code: "agent-crashed" };
        break;
      }
    }
  } catch (err) {
    error = crashed(err);
  } finally {
    await transport?.close().catch(() => undefined);
    await rpc.close().catch(() => undefined);
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
  return error ? { ok: false, turns, error } : { ok: true, turns };
}

/** One turn on the open session, bounded by the turn timeout and the run's stop; never throws. */
async function oneTurn(transport: Transport, prompt: string, o: SystemSessionOptions): Promise<SystemTaskResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (o.signal?.aborted) controller.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), o.turnTimeoutMs ?? TURN_TIMEOUT_MS);
  const result: SystemTaskResult = { ok: false };
  try {
    await transport.turn(
      prompt,
      (e: Event) => {
        if (e.type === "usage") {
          const u = result.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
          result.usage = {
            inputTokens: u.inputTokens + e.inputTokens,
            outputTokens: u.outputTokens + e.outputTokens,
            cacheReadTokens: u.cacheReadTokens + e.cacheReadTokens,
            cacheWriteTokens: u.cacheWriteTokens + e.cacheWriteTokens,
            // Only when some call reported a cost (OpenCode): no cost is not US$ 0.
            ...(u.costUsd !== undefined || e.costUsd !== undefined ? { costUsd: (u.costUsd ?? 0) + (e.costUsd ?? 0) } : {}),
          };
          if (e.model) result.model = e.model;
        } else if (e.type === "limits") result.limits = e.windows;
        else if (e.type === "done") {
          result.ok = e.ok;
          if (!e.ok) result.error = e.error;
        }
      },
      controller.signal,
      o.profile,
    );
  } catch (err) {
    result.ok = false;
    result.error = crashed(err);
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
  }
  // A stopped or timed-out turn never counts as done, whatever the engine said last.
  if (controller.signal.aborted) {
    result.ok = false;
    result.error ??= { code: "cancelled" };
  }
  return result;
}
