import { type ChildProcess, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";
import type { Permissions } from "@humanharness/harness-sdk";
import { classifyError } from "./classify";
import { type ActivityKind, type Event, fail } from "./events";
import type { Transport, TransportOptions } from "./transport";

type PermissionOption = { optionId: string; kind: string };
type PermissionRequest = {
  toolCall: {
    toolCallId: string;
    title?: string | null;
    kind?: string | null;
    locations?: { path: string }[] | null;
    rawInput?: unknown;
  };
  options: PermissionOption[];
  _meta?: Record<string, unknown> | null;
};
type PermissionResponse = { outcome: { outcome: "selected"; optionId: string } | { outcome: "cancelled" } };

export interface PermissionPolicy {
  folder: string;
  /** Reference folders: reads and searches there are allowed, never edits. */
  readRoots?: string[];
  permissions: Permissions;
  /** MCP servers the harness configured (always includes "ui"). */
  mcpServers: string[];
  /** Earlier tool_call info by id (Codex permission requests carry only the id). */
  lookup: (toolCallId: string) => { server?: string } | undefined;
}

const UI_TITLE = /^mcp(__|\.)ui(__|\.)/;

const GRACE_MS = 5000;
const KILL_MS = 3000;
const STDERR_KEEP = 4096;

class OutdatedAdapterError extends Error {}

function versionLess(a: string, b: string): boolean {
  const parse = (v: string) => v.split(/[-+]/)[0].split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parse(a), parse(b)];
  for (let i = 0; i < 3; i++) {
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0);
  }
  return false;
}

function serverOf(rawInput: unknown): string | undefined {
  const server = (rawInput as { server?: unknown } | null | undefined)?.server;
  return typeof server === "string" ? server : undefined;
}

/** Block tools of the core `ui` MCP server, as Claude (`mcp__ui__x`) or Codex (`mcp.ui.x`, rawInput.server) report them. */
export function isUiTool(title: string | null | undefined, rawInput: unknown): boolean {
  return serverOf(rawInput) === "ui" || UI_TITLE.test(title ?? "");
}

function inside(folder: string, target: string): boolean {
  const root = path.resolve(folder);
  const resolved = path.resolve(root, target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** Answers ACP permission requests from the harness manifest, without asking the user. Never picks "always" options. */
export function decidePermission(params: PermissionRequest, policy: PermissionPolicy): PermissionResponse {
  const { toolCallId, kind, locations, rawInput } = params.toolCall;
  // rawInput is model-written: only the recorded server of a trusted tool_call counts.
  const recorded = params._meta?.is_mcp_tool_approval === true ? policy.lookup(toolCallId)?.server : undefined;
  let allow: boolean;
  if (recorded !== undefined) {
    const server = recorded;
    allow = server !== undefined && policy.mcpServers.includes(server);
  } else {
    const allInside = (locations ?? []).every((l) => inside(policy.folder, l.path));
    switch (kind) {
      case "read":
      case "search":
      case "think":
        allow = (locations ?? []).every((l) => [policy.folder, ...(policy.readRoots ?? [])].some((root) => inside(root, l.path)));
        break;
      case "edit":
      case "delete":
      case "move":
        allow = policy.permissions.edit === "folder" && (locations ?? []).length > 0 && allInside;
        break;
      case "fetch":
        allow = policy.permissions.web;
        break;
      default: // "execute", "other", unknown
        allow = policy.permissions.exec;
    }
  }
  const option = params.options.find((o) => o.kind === (allow ? "allow_once" : "reject_once"));
  return option ? { outcome: { outcome: "selected", optionId: option.optionId } } : { outcome: { outcome: "cancelled" } };
}

const KINDS: Record<string, ActivityKind> = {
  read: "read", search: "search", edit: "edit", delete: "edit", move: "edit", fetch: "web", execute: "exec",
};

function errorFrom(e: unknown, stderr = ""): Event {
  const err = e as { code?: unknown; message?: string };
  if (err?.code === "ENOENT") return fail("engine-not-installed", err.message);
  if (e instanceof OutdatedAdapterError) return fail("outdated-version", e.message);
  if (e instanceof acp.RequestError && e.code === -32000) return fail("session-expired", e.message);
  const message = err?.message ?? String(e);
  // A plain (non-RPC) error means the connection closed under us: the agent's stderr says why.
  if (!(e instanceof acp.RequestError) && stderr.trim()) return fail(classifyError(`${message}\n${stderr}`), stderr.trim());
  return fail(classifyError(message), message);
}

type AcpUsage = { inputTokens?: number; outputTokens?: number; cachedReadTokens?: number; cachedWriteTokens?: number };

/** Long-lived ACP agent per window; one `session/prompt` per turn. */
export class AcpTransport implements Transport {
  private child?: ChildProcess;
  private conn?: acp.ClientConnection;
  private sessionId?: string;
  private emit: ((e: Event) => void) | null = null;
  private calls = new Map<string, { server?: string }>();
  private hidden = new Set<string>();
  private activities = new Map<string, { kind: ActivityKind; detail: string }>();
  private afterTool = false;
  private stderrTail = "";
  /** What the agent advertised at initialize. */
  private loadable = false;
  private closable = false;

  constructor(private readonly o: TransportOptions) {}

  /** Starts the agent process and initializes the connection. */
  private async connect(): Promise<void> {
    const [binary, ...args] = this.o.command;
    const child = spawn(binary, args, {
      cwd: this.o.folder,
      env: { ...process.env, ...this.o.env },
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    this.child = child;
    this.stderrTail = "";
    child.on("exit", () => {
      if (this.child === child) this.reset();
    });
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", () => resolve());
      child.once("error", reject);
    });
    child.on("error", () => {}); // late errors (e.g. a failed kill) must not be uncaught
    child.stderr!.on("data", (d: Buffer) => {
      this.stderrTail = (this.stderrTail + d.toString()).slice(-STDERR_KEEP);
    });

    const policy: PermissionPolicy = {
      folder: this.o.folder,
      permissions: this.o.permissions,
      readRoots: this.o.references ?? [],
      mcpServers: this.o.mcp.map((s) => s.name),
      lookup: (id) => this.calls.get(id),
    };
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    );
    this.conn = acp
      .client({ name: "humanharness" })
      .onRequest("session/request_permission", (ctx) => decidePermission(ctx.params as PermissionRequest, policy) as never)
      .onNotification("session/update", (ctx) => this.onUpdate(ctx.params.update as Record<string, any>))
      .connect(stream);

    const init = await this.conn.agent.request("initialize", {
      protocolVersion: acp.PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const version = (init as { agentInfo?: { version?: string } | null }).agentInfo?.version;
    if (this.o.minAdapterVersion && version && versionLess(version, this.o.minAdapterVersion)) {
      throw new OutdatedAdapterError(`ACP adapter ${version} is older than required ${this.o.minAdapterVersion}`);
    }
    this.loadable = Boolean(init.agentCapabilities?.loadSession);
    this.closable = Boolean(init.agentCapabilities?.sessionCapabilities?.close);
  }

  private mcpServers() {
    return this.o.mcp.map((s) => ({
      name: s.name,
      command: s.command,
      args: s.args,
      env: Object.entries(s.env).map(([name, value]) => ({ name, value })),
    }));
  }

  /** Loads the saved session (when there is one and the agent can) or creates a new one, then sets its mode. */
  private async openSession(): Promise<void> {
    const agent = this.conn!.agent;
    const mcpServers = this.mcpServers();
    if (this.o.session.started && this.loadable) {
      try {
        await agent.request("session/load", { sessionId: this.o.session.id, cwd: this.o.folder, mcpServers });
        this.sessionId = this.o.session.id;
      } catch (e) {
        // An expired login must surface; any other load failure (lost session) falls back to a fresh one.
        const event = errorFrom(e);
        if (event.type === "done" && !event.ok && event.error?.code === "session-expired") throw e;
      }
    }
    if (!this.sessionId) {
      const created = (await agent.request("session/new", { cwd: this.o.folder, mcpServers })) as { sessionId: string };
      this.sessionId = created.sessionId;
      this.o.session = { id: created.sessionId, started: true };
      this.o.onSessionStarted(this.o.session);
    }
    if (this.o.sessionMode) {
      await agent.request("session/set_mode", { sessionId: this.sessionId, modeId: this.o.sessionMode });
    }
  }

  private reset(): void {
    this.conn = undefined;
    this.child = undefined;
    this.sessionId = undefined;
    this.calls.clear();
    this.hidden.clear();
    this.activities.clear();
  }

  private signalGroup(child: ChildProcess, sig: NodeJS.Signals): void {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, sig);
      else child.kill(sig);
    } catch {
      try {
        child.kill(sig);
      } catch {}
    }
  }

  /** SIGTERM the process group, SIGKILL after a delay; resolves when the child has exited. */
  private async terminate(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.signalGroup(child, "SIGKILL"), KILL_MS);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.signalGroup(child, "SIGTERM");
    });
  }

  private onUpdate(u: Record<string, any>): void {
    const emit = this.emit;
    if (!emit) return;
    switch (u.sessionUpdate) {
      case "agent_message_chunk":
        if (u.content?.type !== "text" || !u.content.text) return;
        if (this.afterTool) {
          emit({ type: "paragraph" });
          this.afterTool = false;
        }
        emit({ type: "text", delta: u.content.text });
        return;
      case "tool_call": {
        // Only Codex's own MCP marker is trusted for the server; rawInput is model-written.
        const server = u._meta?.is_mcp_tool_call === true ? serverOf(u.rawInput) : undefined;
        this.calls.set(u.toolCallId, { server });
        if (u.kind === "think" || server === "ui") {
          this.hidden.add(u.toolCallId);
          return;
        }
        const activity = { kind: KINDS[u.kind] ?? ("other" as const), detail: String(u.title ?? "") };
        this.activities.set(u.toolCallId, activity);
        this.afterTool = true;
        emit({ type: "activity", id: u.toolCallId, ...activity, state: "start" });
        return;
      }
      case "tool_call_update": {
        if (this.hidden.has(u.toolCallId)) return;
        const activity = this.activities.get(u.toolCallId);
        if (!activity || (u.status !== "completed" && u.status !== "failed")) return;
        this.activities.delete(u.toolCallId);
        emit({ type: "activity", id: u.toolCallId, ...activity, state: "end", error: u.status === "failed" });
        return;
      }
    }
  }

  async turn(message: string, emit: (e: Event) => void, signal: AbortSignal): Promise<void> {
    this.calls.clear();
    this.hidden.clear();
    this.activities.clear();
    if (!this.conn || !this.sessionId) {
      try {
        if (!this.conn) await this.connect();
        await this.openSession();
      } catch (e) {
        const event = errorFrom(e, this.stderrTail);
        await this.close();
        emit(event);
        return;
      }
    }
    if (signal.aborted) {
      emit(fail("cancelled"));
      return;
    }
    const agent = this.conn!.agent;
    const child = this.child!;
    const sessionId = this.sessionId!;
    this.emit = emit;
    this.afterTool = false;
    let grace: ReturnType<typeof setTimeout> | undefined;
    const onAbort = () => {
      void agent.notify("session/cancel", { sessionId });
      // An agent that ignores the cancel must not hang the turn.
      grace ??= setTimeout(() => void this.terminate(child), GRACE_MS);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    let expired = false;
    try {
      const pending = agent.request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: message }],
      });
      // The signal may have fired while the prompt was being sent.
      if (signal.aborted) onAbort();
      const res = (await pending) as { stopReason: string; usage?: AcpUsage | null };
      if (res.usage) {
        emit({
          type: "usage",
          inputTokens: res.usage.inputTokens ?? 0,
          outputTokens: res.usage.outputTokens ?? 0,
          cacheReadTokens: res.usage.cachedReadTokens ?? 0,
          cacheWriteTokens: res.usage.cachedWriteTokens ?? 0,
        });
      }
      if (res.stopReason === "cancelled" || signal.aborted) emit(fail("cancelled"));
      else if (res.stopReason === "refusal") emit(fail("agent-crashed", "refusal"));
      else emit({ type: "done", ok: true });
    } catch (e) {
      if (signal.aborted) emit(fail("cancelled"));
      else {
        const event = errorFrom(e, this.stderrTail);
        expired = event.type === "done" && !event.ok && event.error?.code === "session-expired";
        emit(event);
      }
    } finally {
      clearTimeout(grace);
      signal.removeEventListener("abort", onAbort);
      this.emit = null;
    }
    // Close after an expired login so the next turn starts a fresh process that sees a new login.
    if (expired) await this.close();
  }

  /** Closes the session (`session/close`, when the agent offers it) and keeps the process for the next one. */
  async endSession(): Promise<void> {
    const sessionId = this.sessionId;
    this.sessionId = undefined;
    this.o.session = { id: randomUUID(), started: false };
    if (!sessionId || !this.conn || !this.closable) return;
    try {
      await this.conn.agent.request("session/close", { sessionId });
    } catch {
      // The next turn opens a new session anyway.
    }
  }

  async close(): Promise<void> {
    const child = this.child;
    this.conn?.close();
    this.reset();
    if (child) await this.terminate(child);
  }
}
