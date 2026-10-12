import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { McpServerSpec } from "@humanharness/blocks";
import type { Permissions } from "@humanharness/harness-sdk";
import { classifyError } from "./classify";
import { type ActivityKind, type Event, fail } from "./events";
import type { Transport, TransportOptions } from "./transport";

const UI_TOOL_PREFIX = "mcp__ui__";
/** Plumbing tools the user should never see as activity. */
const NO_CONVERSATION = /no conversation found/i;
const HIDDEN_TOOLS = new Set(["ToolSearch", "TodoWrite"]);

export function allowedTools(permissions: Permissions, mcp: McpServerSpec[]): string[] {
  const tools = ["Read", "Glob", "Grep", "TodoWrite"];
  if (permissions.edit === "folder") tools.push("Edit(./**)", "Write(./**)", "MultiEdit(./**)");
  if (permissions.web) tools.push("WebSearch", "WebFetch");
  if (permissions.exec) tools.push("Bash");
  for (const server of mcp) tools.push(`mcp__${server.name}`);
  return tools;
}

/** Deny rules beat allow rules, so project settings or hooks cannot re-enable what the manifest excludes. */
export function disallowedTools(permissions: Permissions, references: string[] = []): string[] {
  const tools = ["AskUserQuestion"];
  if (permissions.edit === "none") tools.push("Edit", "Write", "MultiEdit", "NotebookEdit");
  if (!permissions.exec) tools.push("Bash");
  if (!permissions.web) tools.push("WebSearch", "WebFetch");
  tools.push("Edit(.claude/**)", "Write(.claude/**)", "MultiEdit(.claude/**)");
  // `--add-dir` makes a reference folder a working directory, where acceptEdits would accept edits:
  // deny them by absolute path (`//` starts an absolute path in permission rules).
  for (const dir of references) tools.push(`Edit(/${dir}/**)`, `Write(/${dir}/**)`, `MultiEdit(/${dir}/**)`);
  return tools;
}

/** Arguments for the unmodified official `claude` binary; the prompt goes in via stdin. Never touches credentials or auth settings. */
export function claudeArgs(o: Pick<TransportOptions, "session" | "mcp" | "permissions" | "persistSession" | "references">): string[] {
  const mcpServers = Object.fromEntries(
    o.mcp.map((s) => [s.name, { type: "stdio", command: s.command, args: s.args, env: s.env }]),
  );
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--setting-sources", "project",
    "--permission-mode", o.permissions.edit === "folder" ? "acceptEdits" : "default",
    "--allowedTools", allowedTools(o.permissions, o.mcp).join(","),
    "--disallowedTools", disallowedTools(o.permissions, o.references ?? []).join(","),
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers }),
    ...(o.references ?? []).flatMap((dir) => ["--add-dir", dir]),
    ...(o.session.started ? ["--resume", o.session.id] : ["--session-id", o.session.id]),
    ...(o.persistSession === false ? ["--no-session-persistence"] : []),
  ];
}

const KINDS: Record<string, ActivityKind> = {
  Read: "read", Glob: "search", Grep: "search", Edit: "edit", Write: "edit", MultiEdit: "edit",
  NotebookEdit: "edit", WebSearch: "web", WebFetch: "web", Bash: "exec",
};

function detailOf(tool: string, input: Record<string, unknown>): string {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : "");
  switch (tool) {
    case "Read": case "Edit": case "Write": case "MultiEdit": case "NotebookEdit":
      return path.basename(str("file_path") || str("notebook_path"));
    case "Glob": case "Grep": return str("pattern");
    case "WebFetch": return str("url");
    case "WebSearch": return str("query");
    case "Bash": return str("command").split("\n")[0].slice(0, 80);
    default: return "";
  }
}

/** Turns Claude Code's stream-json lines into normalized events. */
export class StreamJsonReader {
  private textOpen = false;
  private newBlock = false;
  private hasText = false;
  private tools = new Map<string, { kind: ActivityKind; detail: string }>();
  resultError: string | null = null;
  sawResult = false;

  constructor(
    private readonly emit: (e: Event) => void,
    private readonly onSessionId: (id: string) => void,
  ) {}

  feed(line: string): void {
    let o: Record<string, any>;
    try {
      o = JSON.parse(line);
    } catch {
      return;
    }
    if (typeof o.session_id === "string") this.onSessionId(o.session_id);
    if ((o.parent_tool_use_id ?? null) !== null) return;

    if (o.type === "rate_limit_event") {
      const info = o.rate_limit_info ?? {};
      const windows = Object.entries((info.unifiedWindows ?? {}) as Record<string, any>).map(([kind, w]) => ({
        kind,
        utilization: Number(w.utilization),
        resetsAt: new Date(Number(w.resetsAt) * 1000).toISOString(),
      }));
      this.emit({ type: "limits", status: String(info.status ?? "allowed"), windows });
      return;
    }

    if (o.type === "stream_event") {
      const ev = o.event ?? {};
      if (ev.type === "content_block_start" && ev.content_block?.type === "text") {
        this.textOpen = true;
        this.newBlock = true;
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && this.textOpen && ev.delta.text) {
        if (this.newBlock && this.hasText) this.emit({ type: "paragraph" });
        this.newBlock = false;
        this.hasText = true;
        this.emit({ type: "text", delta: ev.delta.text });
      } else if (ev.type === "content_block_stop") {
        this.textOpen = false;
      }
      return;
    }

    if (o.type === "assistant") {
      for (const b of o.message?.content ?? []) {
        if (b.type !== "tool_use" || String(b.name).startsWith(UI_TOOL_PREFIX) || HIDDEN_TOOLS.has(b.name)) continue;
        if (this.tools.has(b.id)) continue;
        const activity = { kind: KINDS[b.name] ?? ("other" as const), detail: detailOf(b.name, b.input ?? {}) };
        this.tools.set(b.id, activity);
        this.emit({ type: "activity", id: b.id, ...activity, state: "start" });
      }
      return;
    }

    if (o.type === "user" && Array.isArray(o.message?.content)) {
      for (const b of o.message.content) {
        if (b.type !== "tool_result") continue;
        const activity = this.tools.get(b.tool_use_id);
        if (!activity) continue;
        this.tools.delete(b.tool_use_id);
        this.emit({ type: "activity", id: b.tool_use_id, ...activity, state: "end", error: Boolean(b.is_error) });
      }
      return;
    }

    if (o.type === "result") {
      this.sawResult = true;
      if (o.usage) {
        this.emit({
          type: "usage",
          inputTokens: o.usage.input_tokens ?? 0,
          outputTokens: o.usage.output_tokens ?? 0,
          cacheReadTokens: o.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: o.usage.cache_creation_input_tokens ?? 0,
          ...(typeof o.total_cost_usd === "number" ? { costEquivalentUsd: o.total_cost_usd } : {}),
        });
      }
      if (o.is_error || (o.subtype && o.subtype !== "success")) {
        this.resultError = (typeof o.result === "string" && o.result) || "Claude Code could not finish the request.";
      }
    }
  }
}

/** Runs one `claude -p` process per turn, resuming the session by id. */
export class ClaudeCliTransport implements Transport {
  constructor(private readonly o: TransportOptions) {}

  private markStarted = (): void => {
    if (this.o.session.started) return;
    this.o.session = { id: this.o.session.id, started: true };
    this.o.onSessionStarted(this.o.session);
  };

  async turn(message: string, emit: (e: Event) => void, signal: AbortSignal): Promise<void> {
    const wasResume = this.o.session.started;
    let last = await this.attempt(message, emit, signal);
    if (wasResume && last.type === "done" && !last.ok && last.error?.detail && NO_CONVERSATION.test(last.error.detail) && !signal.aborted) {
      // The stored session is gone on the CLI side: continue the chat in a fresh one.
      this.o.session = { id: randomUUID(), started: false };
      last = await this.attempt(message, emit, signal);
      if (last.type === "done" && last.ok) this.markStarted();
    }
    emit(last);
  }

  /** Runs one process; resolves with the terminal event instead of emitting it. */
  private attempt(message: string, rawEmit: (e: Event) => void, signal: AbortSignal): Promise<Event> {
    return new Promise((resolve) => {
      let finished = false;
      let killTimer: NodeJS.Timeout | undefined;
      let graceTimer: NodeJS.Timeout | undefined;
      const emit = (e: Event) => {
        if (!finished) rawEmit(e);
      };
      const finish = (e: Event) => {
        if (finished) return;
        finished = true;
        clearTimeout(graceTimer);
        signal.removeEventListener("abort", onAbort);
        resolve(e);
      };
      const useGroup = process.platform !== "win32";
      const [binary, ...leading] = this.o.command;
      const child = spawn(binary, [...leading, ...claudeArgs(this.o)], {
        cwd: this.o.folder,
        env: { ...process.env, ...this.o.env },
        stdio: ["pipe", "pipe", "pipe"],
        detached: useGroup,
      });
      child.stdin!.on("error", () => {}); // the child may exit before reading the prompt
      child.stdin!.end(message);
      const killTree = (sig: NodeJS.Signals) => {
        try {
          if (useGroup && child.pid) process.kill(-child.pid, sig);
          else child.kill(sig);
        } catch {
          try { child.kill(sig); } catch { /* already gone */ }
        }
      };
      const onAbort = () => {
        killTree("SIGTERM");
        // Escalate: kill the whole group (including stragglers that ignore SIGTERM) after 3 s.
        killTimer = setTimeout(() => killTree("SIGKILL"), 3000);
        killTimer.unref();
      };
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) onAbort();

      const reader = new StreamJsonReader(emit, this.markStarted);
      let rest = "";
      child.stdout!.setEncoding("utf8");
      child.stdout!.on("data", (chunk: string) => {
        rest += chunk;
        let i: number;
        while ((i = rest.indexOf("\n")) >= 0) {
          const line = rest.slice(0, i).trim();
          rest = rest.slice(i + 1);
          if (line) reader.feed(line);
        }
      });
      let stderr = "";
      child.stderr!.setEncoding("utf8");
      child.stderr!.on("data", (c: string) => (stderr = (stderr + c).slice(-4000)));

      const settle = (code: number | null, sig: NodeJS.Signals | null) => {
        if (finished) return;
        clearTimeout(killTimer);
        if (useGroup && child.pid) {
          // Leave no stragglers behind once the leader is gone.
          try { process.kill(-child.pid, "SIGKILL"); } catch { /* none left */ }
        }
        const tail = rest.trim();
        rest = "";
        if (tail) reader.feed(tail);
        if (signal.aborted) finish(fail("cancelled"));
        else if (reader.resultError) finish(fail(classifyError(reader.resultError), reader.resultError));
        else if (sig) finish(fail(classifyError(stderr), stderr.trim() || `exit signal ${sig}`));
        else if (code !== 0) finish(fail(classifyError(stderr), stderr.trim() || `exit code ${code}`));
        else if (!reader.sawResult) finish(fail("agent-crashed", "no result"));
        else finish({ type: "done", ok: true });
      };

      child.on("error", (e: NodeJS.ErrnoException) => {
        finish(fail(e.code === "ENOENT" ? "engine-not-installed" : "agent-crashed", e.message));
      });
      // `exit` fires when the leader dies even if a grandchild holds the pipes open; give stdout a moment to drain.
      child.on("exit", (code, sig) => {
        graceTimer = setTimeout(() => settle(code, sig), 200);
      });
      child.on("close", (code, sig) => {
        clearTimeout(graceTimer);
        settle(code, sig);
      });
    });
  }

  /** Claude keeps the old session on its side; the app never resumes it. The next turn uses a new `--session-id`. */
  async endSession(): Promise<void> {
    this.o.session = { id: randomUUID(), started: false };
  }

  async close(): Promise<void> {}
}
