import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Launcher, devLauncher, openRpc } from "@humanharness/blocks";
import type { EngineDef, ModelProfile } from "@humanharness/engines";
import { materialServerSpec } from "@humanharness/material/light";
import { AcpTransport } from "./acp";
import { ClaudeCliTransport } from "./claude-cli";
import type { EngineError, Event, LimitWindow } from "./events";
import { type Transport, type TransportOptions, acpFields } from "./transport";

export interface SystemTaskOptions {
  engine: EngineDef;
  /** The engine's CLI (from `engineCommand`, or a fake one in tests). */
  command: string[];
  env?: Record<string, string>;
  launcher?: Launcher;
  /** Built `material` server entry (app); defaults to the TS source. */
  entry?: string;
  prompt: string;
  /** The stage's tools on the `material` server (system mode). */
  tools: readonly string[];
  /** Answers the server's calls (`{ op, ...args }`); a throw is a refusal the AI reads. */
  handle: (request: unknown) => Promise<unknown>;
  profile?: ModelProfile;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface SystemTaskResult {
  ok: boolean;
  error?: EngineError;
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  model?: string;
  limits?: LimitWindow[];
}

const TIMEOUT_MS = 10 * 60_000;

/**
 * One AI stage of material processing (material spec §10): a short session in an empty temporary folder, with only
 * the `material` server (system mode), no edits, no web, no commands, and no saved session. Never throws: a crash, a
 * timeout or a stop (`signal`) is a failed result.
 */
export async function runSystemTask(o: SystemTaskOptions): Promise<SystemTaskResult> {
  let folder: string;
  try {
    folder = await fs.mkdtemp(path.join(os.tmpdir(), "hh-material-"));
  } catch (err) {
    return { ok: false, error: { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) } };
  }
  const rpc = await openRpc(o.handle).catch(() => null);
  if (!rpc) {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
    return { ok: false, error: { code: "agent-crashed", detail: "rpc" } };
  }
  const options: TransportOptions = {
    folder,
    session: { id: randomUUID(), started: false },
    mcp: [materialServerSpec({ rpc, launcher: o.launcher ?? devLauncher(), mode: "system", tools: o.tools, ...(o.entry ? { entry: o.entry } : {}) })],
    permissions: { edit: "none", exec: false, web: false },
    ...acpFields(o.engine, "none"),
    persistSession: false,
    command: o.command,
    ...(o.env ? { env: o.env } : {}),
    onSessionStarted: () => {},
  };
  const transport: Transport = o.engine.transport.kind === "claude-cli" ? new ClaudeCliTransport(options) : new AcpTransport(options);
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (o.signal?.aborted) controller.abort();
  o.signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), o.timeoutMs ?? TIMEOUT_MS);
  const result: SystemTaskResult = { ok: false };
  const add = (e: Extract<Event, { type: "usage" }>) => {
    const u = result.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    result.usage = {
      inputTokens: u.inputTokens + e.inputTokens,
      outputTokens: u.outputTokens + e.outputTokens,
      cacheReadTokens: u.cacheReadTokens + e.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens + e.cacheWriteTokens,
    };
    if (e.model) result.model = e.model;
  };
  try {
    await transport.turn(
      o.prompt,
      (e) => {
        if (e.type === "usage") add(e);
        else if (e.type === "limits") result.limits = e.windows;
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
    result.error = { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener("abort", onAbort);
    await transport.close().catch(() => undefined);
    await rpc.close().catch(() => undefined);
    await fs.rm(folder, { recursive: true, force: true }).catch(() => undefined);
  }
  // A stopped or timed-out session never counts as done, whatever the engine said last.
  if (controller.signal.aborted) {
    result.ok = false;
    result.error ??= { code: "cancelled" };
  }
  return result;
}
