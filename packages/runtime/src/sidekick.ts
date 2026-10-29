import { randomUUID } from "node:crypto";
import type { CommonOptions, EngineDef, ModelProfile, Transport } from "@humanharness/engines";
import { createTransport } from "@humanharness/engines/registry";
import type { EngineError, Event, LimitWindow } from "./events";
import type { SystemTaskResult } from "./system";

export interface SidekickSessionOptions {
  engine: EngineDef;
  command: string[];
  env?: Record<string, string>;
  /** The session's own working folder (holds its AGENTS.md); never the base. */
  folder: string;
  /** Fixed for the session (plan 3c). */
  profile: ModelProfile;
  /** Tests only: builds the transport. */
  transport?: (o: CommonOptions) => Transport;
}

export interface SidekickAnswer {
  ok: boolean;
  /** The reply's text (paragraphs joined by a blank line). */
  text: string;
  usage?: SystemTaskResult["usage"];
  /** The plan's limit windows, when the engine reported them in this turn. */
  limits?: LimitWindow[];
  model?: string;
  error?: EngineError;
}

/**
 * Sidekick's session for one task (sidekick spec §5): a second transport with its own session id, no tools, no MCP
 * servers, no permissions. Turns run one at a time. Never throws from `ask`: a crash, an abort or an engine error
 * is a failed answer. `close()` waits for a running turn: abort its signal first to end it at once.
 */
export class SidekickSession {
  private readonly transport: Transport;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(readonly o: SidekickSessionOptions) {
    // The ACP adapter adds the read-only session mode from `permissions.edit`.
    const options: CommonOptions = {
      folder: o.folder,
      session: { id: randomUUID(), started: false },
      mcp: [],
      permissions: { edit: "none", exec: false, web: false },
      noTools: true,
      command: o.command,
      ...(o.env ? { env: o.env } : {}),
      onSessionStarted: () => {},
    };
    this.transport = o.transport?.(options) ?? createTransport(o.engine, options);
  }

  get profile(): ModelProfile {
    return this.o.profile;
  }

  ask(prompt: string, signal: AbortSignal): Promise<SidekickAnswer> {
    const run = () => this.turn(prompt, signal);
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async turn(prompt: string, signal: AbortSignal): Promise<SidekickAnswer> {
    if (this.closed || signal.aborted) return { ok: false, text: "", error: { code: "cancelled" } };
    const answer: SidekickAnswer = { ok: false, text: "" };
    const parts: string[] = [""];
    const onEvent = (e: Event) => {
      if (e.type === "text") parts[parts.length - 1] += e.delta;
      else if (e.type === "paragraph") parts.push("");
      else if (e.type === "usage") {
        const u = answer.usage ?? { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
        answer.usage = {
          inputTokens: u.inputTokens + e.inputTokens,
          outputTokens: u.outputTokens + e.outputTokens,
          cacheReadTokens: u.cacheReadTokens + e.cacheReadTokens,
          cacheWriteTokens: u.cacheWriteTokens + e.cacheWriteTokens,
          ...(u.costUsd !== undefined || e.costUsd !== undefined ? { costUsd: (u.costUsd ?? 0) + (e.costUsd ?? 0) } : {}),
        };
        if (e.model) answer.model = e.model;
      } else if (e.type === "limits") answer.limits = e.windows;
      else if (e.type === "done") {
        answer.ok = e.ok;
        if (!e.ok) answer.error = e.error;
      }
    };
    try {
      await this.transport.turn(prompt, onEvent, signal, this.o.profile);
    } catch (err) {
      answer.ok = false;
      answer.error = { code: "agent-crashed", detail: err instanceof Error ? err.message : String(err) };
    }
    if (signal.aborted) {
      answer.ok = false;
      answer.error = { code: "cancelled" };
    }
    answer.text = parts.filter((p) => p.trim()).join("\n\n").trim();
    return answer;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.queue.catch(() => undefined);
    await this.transport.close().catch(() => undefined);
  }
}
