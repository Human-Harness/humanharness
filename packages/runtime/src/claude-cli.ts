import { spawn } from "node:child_process";
import path from "node:path";
import type { McpServerSpec } from "@humanharness/blocks";
import type { Permissions } from "@humanharness/harness-sdk";
import { classifyError } from "./classify";
import { type ActivityKind, type Event, fail } from "./events";
import type { Transport, TransportOptions } from "./transport";

const UI_TOOL_PREFIX = "mcp__ui__";

export function allowedTools(permissions: Permissions, mcp: McpServerSpec[]): string[] {
  const tools = ["Read", "Glob", "Grep", "TodoWrite"];
  if (permissions.edit === "folder") tools.push("Edit", "Write", "MultiEdit");
  if (permissions.web) tools.push("WebSearch", "WebFetch");
  if (permissions.exec) tools.push("Bash");
  for (const server of mcp) tools.push(`mcp__${server.name}`);
  return tools;
}

/** Arguments for the unmodified official `claude` binary. Never touches credentials or auth settings. */
export function claudeArgs(message: string, o: Pick<TransportOptions, "session" | "mcp" | "permissions">): string[] {
  const mcpServers = Object.fromEntries(
    o.mcp.map((s) => [s.name, { type: "stdio", command: s.command, args: s.args, env: s.env }]),
  );
  return [
    "-p", message,
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--setting-sources", "project",
    "--permission-mode", o.permissions.edit === "folder" ? "acceptEdits" : "default",
    "--allowedTools", allowedTools(o.permissions, o.mcp).join(","),
    "--disallowedTools", "AskUserQuestion",
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers }),
    ...(o.session.started ? ["--resume", o.session.id] : ["--session-id", o.session.id]),
  ];
}

const KINDS: Record<string, ActivityKind> = {
  Read: "read", Glob: "search", Grep: "search", Edit: "edit", Write: "edit", MultiEdit: "edit",
  NotebookEdit: "edit", WebSearch: "web", WebFetch: "web", Bash: "exec",
};

function detailOf(input: Record<string, unknown>): string {
  for (const key of ["file_path", "path", "pattern", "url", "query", "command"]) {
    const value = input[key];
    if (typeof value === "string") return key === "file_path" || key === "path" ? path.basename(value) : value;
  }
  return "";
}

/** Turns Claude Code's stream-json lines into normalized events. */
export class StreamJsonReader {
  private textOpen = false;
  private hasText = false;
  private tools = new Map<string, { kind: ActivityKind; detail: string }>();
  resultError: string | null = null;

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
        if (this.hasText) this.emit({ type: "paragraph" });
        this.textOpen = true;
      } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta" && this.textOpen && ev.delta.text) {
        this.hasText = true;
        this.emit({ type: "text", delta: ev.delta.text });
      } else if (ev.type === "content_block_stop") {
        this.textOpen = false;
      }
      return;
    }

    if (o.type === "assistant") {
      for (const b of o.message?.content ?? []) {
        if (b.type !== "tool_use" || String(b.name).startsWith(UI_TOOL_PREFIX)) continue;
        const activity = { kind: KINDS[b.name] ?? ("other" as const), detail: detailOf(b.input ?? {}) };
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

  turn(message: string, emit: (e: Event) => void, signal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      let finished = false;
      const finish = (e: Event) => {
        if (finished) return;
        finished = true;
        signal.removeEventListener("abort", onAbort);
        emit(e);
        resolve();
      };
      const [binary, ...leading] = this.o.command;
      const child = spawn(binary, [...leading, ...claudeArgs(message, this.o)], {
        cwd: this.o.folder,
        env: { ...process.env, ...this.o.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      const onAbort = () => child.kill("SIGTERM");
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

      child.on("error", (e: NodeJS.ErrnoException) =>
        finish(fail(e.code === "ENOENT" ? "engine-not-installed" : "agent-crashed", e.message)),
      );
      child.on("close", (code) => {
        if (signal.aborted) finish(fail("cancelled"));
        else if (reader.resultError) finish(fail(classifyError(reader.resultError), reader.resultError));
        else if (code !== 0) finish(fail(classifyError(stderr), stderr.trim() || `exit code ${code}`));
        else finish({ type: "done", ok: true });
      });
    });
  }

  async close(): Promise<void> {}
}
