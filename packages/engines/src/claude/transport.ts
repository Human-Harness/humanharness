import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { McpServerSpec } from "@humanharness/blocks";
import type { Permissions } from "@humanharness/harness-sdk";
import { classifyError } from "../classify";
import { type ActivityKind, type CommonOptions, EDIT_PATH_MAX, type Event, type Transport, fail } from "../contract";
import { type ModelProfile, isCap, isEffort, isModelId } from "../models";

const UI_TOOL_PREFIX = "mcp__ui__";
/** Plumbing tools the user should never see as activity. */
const NO_CONVERSATION = /no conversation found/i;
const HIDDEN_TOOLS = new Set(["ToolSearch", "TodoWrite"]);

/** Tokens of context a call used: its fresh input plus what it read from and wrote to the cache. */
const contextOf = (u: Record<string, unknown>): number =>
  (Number(u.input_tokens) || 0) + (Number(u.cache_read_input_tokens) || 0) + (Number(u.cache_creation_input_tokens) || 0);

/** Claude's built-in reading tools; an MCP-only session gets none of them. */
const READ_TOOLS = ["Read", "Glob", "Grep", "TodoWrite"];
/** Further built-in tools an MCP-only session never needs: subagents, listing, notebooks, skills, slash commands, web. */
const MCP_ONLY_DENIED = [...READ_TOOLS, "Task", "Agent", "LS", "NotebookRead", "NotebookEdit", "Skill", "SlashCommand", "WebFetch", "WebSearch"];

export function allowedTools(permissions: Permissions, mcp: McpServerSpec[], mcpOnly = false): string[] {
  const tools = mcpOnly ? [] : [...READ_TOOLS];
  if (permissions.edit === "folder") tools.push("Edit(./**)", "Write(./**)", "MultiEdit(./**)");
  if (permissions.web) tools.push("WebSearch", "WebFetch");
  if (permissions.exec) tools.push("Bash");
  for (const server of mcp) tools.push(`mcp__${server.name}`);
  return tools;
}

/** Deny rules beat allow rules, so project settings or hooks cannot re-enable what the manifest excludes. */
export function disallowedTools(permissions: Permissions, references: string[] = [], mcpOnly = false): string[] {
  const tools = ["AskUserQuestion", ...(mcpOnly ? MCP_ONLY_DENIED : [])];
  const deny = (...names: string[]) => tools.push(...names.filter((n) => !tools.includes(n)));
  if (permissions.edit === "none") deny("Edit", "Write", "MultiEdit", "NotebookEdit");
  if (!permissions.exec) deny("Bash");
  if (!permissions.web) deny("WebSearch", "WebFetch");
  tools.push("Edit(.claude/**)", "Write(.claude/**)", "MultiEdit(.claude/**)");
  // `permissions.additionalDirectories` makes a reference folder a working directory, where acceptEdits would
  // accept edits: deny them by absolute path (`//` starts an absolute path in permission rules).
  for (const ref of references) {
    const dir = referenceRulePath(ref);
    tools.push(`Edit(/${dir}/**)`, `Write(/${dir}/**)`, `MultiEdit(/${dir}/**)`);
  }
  return tools;
}

/**
 * An absolute folder as permission rules spell it: resolved, without a trailing slash, with forward
 * slashes (`C:\a\b` becomes `/c/a/b` on Windows). The root folder becomes "".
 */
export function referenceRulePath(dir: string, platform: NodeJS.Platform = process.platform): string {
  if (platform === "win32") {
    const resolved = path.win32.resolve(dir);
    const drive = /^([a-zA-Z]):(.*)$/.exec(resolved);
    const rest = (drive ? drive[2] : resolved).replace(/\\/g, "/").replace(/\/+$/, "");
    return drive ? `/${drive[1].toLowerCase()}${rest}` : rest;
  }
  return path.posix.resolve(dir).replace(/\/+$/, "");
}

/**
 * `--model`, `--effort` and `--autocompact` for the task's profile (resources spec §5.2), on the first turn
 * and every `--resume`. Checked again here: nothing that reads as a flag reaches the CLI.
 */
export function profileArgs(profile: ModelProfile | undefined): string[] {
  if (!profile) return [];
  if (profile.model !== undefined && !isModelId(profile.model)) {
    throw new Error(`Refusing a model id that reads as a flag: ${JSON.stringify(profile.model)}`);
  }
  if (!isEffort(profile.effort)) throw new Error(`Unknown effort: ${JSON.stringify(profile.effort)}`);
  if (!isCap(profile.cap)) throw new Error(`Context cap out of range: ${JSON.stringify(profile.cap)}`);
  return [...(profile.model !== undefined ? ["--model", profile.model] : []), "--effort", profile.effort, "--autocompact", String(profile.cap)];
}

/** Every built-in Claude Code tool, denied by name in a no-tools session (in case `--tools ""` is ignored). */
export const ALL_BUILTIN_TOOLS = [
  "Read", "Glob", "Grep", "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebSearch", "WebFetch", "TodoWrite", "Task",
  "AskUserQuestion", "ToolSearch",
] as const;

/**
 * `--settings` for the reference folders, or nothing without any (D0). They go in as
 * `permissions.additionalDirectories`, not `--add-dir`: an `--add-dir` folder also loads its `.claude/skills`,
 * `.claude/commands` and `.claude/agents` under the project source, code nobody approved. The settings key
 * "grants file access only and loads none of these" (code.claude.com/docs/en/permissions, "Additional
 * directories grant file access, not configuration").
 */
export function referenceSettingsArgs(references: string[]): string[] {
  if (references.length === 0) return [];
  return ["--settings", JSON.stringify({ permissions: { additionalDirectories: references } })];
}

/** Arguments for the unmodified official `claude` binary; the prompt goes in via stdin. Never touches credentials or auth settings. */
export function claudeArgs(
  o: Pick<CommonOptions, "session" | "mcp" | "permissions" | "persistSession" | "references" | "noTools" | "mcpOnly"> & { profile?: ModelProfile },
): string[] {
  if (o.session.id.startsWith("-")) throw new Error(`Refusing a session id that reads as a flag: ${JSON.stringify(o.session.id)}`);
  if (o.noTools && (o.mcp.length > 0 || (o.references ?? []).length > 0)) {
    throw new Error("A no-tools session takes no MCP servers or reference folders");
  }
  const mcpServers = Object.fromEntries(
    o.mcp.map((s) => [s.name, { type: "stdio", command: s.command, args: s.args, env: s.env }]),
  );
  // The non-noTools flags keep their old order: a session without `noTools` runs exactly as before (D0).
  const tools = o.noTools
    ? ["--tools", "", "--disallowedTools", ALL_BUILTIN_TOOLS.join(",")]
    : [
        "--allowedTools", allowedTools(o.permissions, o.mcp, o.mcpOnly).join(","),
        "--disallowedTools", disallowedTools(o.permissions, o.references ?? [], o.mcpOnly).join(","),
      ];
  return [
    "-p",
    "--output-format", "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--setting-sources", "project",
    "--permission-mode", o.permissions.edit === "folder" ? "acceptEdits" : "default",
    ...tools,
    "--strict-mcp-config",
    "--mcp-config", JSON.stringify({ mcpServers }),
    ...referenceSettingsArgs(o.references ?? []),
    ...(o.session.started ? ["--resume", o.session.id] : ["--session-id", o.session.id]),
    ...(o.persistSession === false ? ["--no-session-persistence"] : []),
    ...profileArgs(o.profile),
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

/** Claude's tools that change a file, and the input field that names it. */
const EDIT_FIELDS: Record<string, string> = { Edit: "file_path", Write: "file_path", MultiEdit: "file_path", NotebookEdit: "notebook_path" };

/**
 * The file an edit tool call names (parallel spec §5.2); empty for any other tool or a malformed input.
 * Claude names the real path (spike PT-S1: /tmp → /private/tmp), so the ledger accepts the folder and its real path.
 */
export function editPaths(tool: string, input: Record<string, unknown>): string[] {
  const field = Object.hasOwn(EDIT_FIELDS, tool) ? EDIT_FIELDS[tool] : undefined;
  const value = field ? input[field] : undefined;
  return typeof value === "string" && value && value.length <= EDIT_PATH_MAX ? [value] : [];
}

/** Longest server or tool name kept. */
const NAME_MAX = 100;
/** Longest engine path kept; a longer one is dropped. */
const PATH_MAX = 4096;

/**
 * What a tool call adds to its start event for the context panel (spec §3.2): the path a Read, Grep or Glob names,
 * or an MCP tool's server and name (`mcp__<server>__<tool>`, split with indexOf).
 */
export function activityExtras(tool: string, input: Record<string, unknown>): { paths?: string[]; tool?: { server: string; name: string } } {
  const str = (key: string) => {
    const v = input[key];
    return typeof v === "string" && v && v.length <= PATH_MAX ? v : undefined;
  };
  if (tool === "Read") {
    const p = str("file_path");
    return p ? { paths: [p] } : {};
  }
  if (tool === "Grep" || tool === "Glob") {
    const p = str("path");
    return p ? { paths: [p] } : {};
  }
  if (tool.startsWith("mcp__")) {
    const rest = tool.slice("mcp__".length);
    const cut = rest.indexOf("__");
    if (cut > 0 && cut + 2 < rest.length) return { tool: { server: rest.slice(0, cut).slice(0, NAME_MAX), name: rest.slice(cut + 2).slice(0, NAME_MAX) } };
  }
  return {};
}

/** Turns Claude Code's stream-json lines into normalized events. */
export class StreamJsonReader {
  private textOpen = false;
  private newBlock = false;
  private hasText = false;
  private tools = new Map<string, { kind: ActivityKind; detail: string }>();
  resultError: string | null = null;
  sawResult = false;
  /** The model the CLI reported at system/init. */
  private model: string | undefined;
  /** Context in use at the last top-level API call. */
  private lastContext: number | null = null;
  /** The plan doesn't include the requested model (`model_not_found`, or a 404 API error that names the model). */
  modelUnavailable = false;

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

    if (o.type === "system" && o.subtype === "init") {
      if (typeof o.model === "string") this.model = o.model;
      return;
    }

    if (o.type === "rate_limit_event") {
      const info = o.rate_limit_info ?? {};
      // A window without a valid reset is left out: `toISOString` would throw, and no reader can place it in time.
      const windows = Object.entries((info.unifiedWindows ?? {}) as Record<string, any>).flatMap(([kind, w]) => {
        const at = new Date(w?.resetsAt == null || w.resetsAt === "" ? Number.NaN : Number(w.resetsAt) * 1000);
        return Number.isFinite(at.getTime()) ? [{ kind, utilization: Number(w.utilization), resetsAt: at.toISOString() }] : [];
      });
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
      if (o.error === "model_not_found") this.modelUnavailable = true;
      if (o.message?.usage) this.lastContext = contextOf(o.message.usage);
      for (const b of o.message?.content ?? []) {
        if (b.type !== "tool_use" || String(b.name).startsWith(UI_TOOL_PREFIX) || HIDDEN_TOOLS.has(b.name)) continue;
        if (this.tools.has(b.id)) continue;
        const activity = { kind: Object.hasOwn(KINDS, b.name) ? KINDS[b.name] : ("other" as const), detail: detailOf(b.name, b.input ?? {}) };
        this.tools.set(b.id, activity);
        const edits = editPaths(String(b.name), b.input ?? {});
        this.emit({ type: "activity", id: b.id, ...activity, ...activityExtras(String(b.name), b.input ?? {}), ...(edits.length > 0 ? { edits } : {}), state: "start" });
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
      // A 404 is about the model only when the CLI says so; any other 404 keeps the usual classification.
      const aboutModel = typeof o.result === "string" && /\bmodel\b/i.test(o.result);
      if (o.error === "model_not_found" || (o.api_error_status === 404 && o.terminal_reason === "api_error" && aboutModel)) this.modelUnavailable = true;
      if (o.usage) {
        this.emit({
          type: "usage",
          inputTokens: o.usage.input_tokens ?? 0,
          outputTokens: o.usage.output_tokens ?? 0,
          cacheReadTokens: o.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: o.usage.cache_creation_input_tokens ?? 0,
          ...(typeof o.total_cost_usd === "number" ? { costEquivalentUsd: o.total_cost_usd } : {}),
          ...(this.model ? { model: this.model } : {}),
        });
      }
      // The last call's size is the context in use; the result's totals add up every call of the turn.
      const used = this.lastContext ?? (o.usage ? contextOf(o.usage) : 0);
      if (used > 0) this.emit({ type: "context", used });
      if (o.is_error || (o.subtype && o.subtype !== "success")) {
        this.resultError = (typeof o.result === "string" && o.result) || "Claude Code could not finish the request.";
      }
    }
  }
}

/** Runs one `claude -p` process per turn, resuming the session by id. */
export class ClaudeCliTransport implements Transport {
  constructor(private readonly o: CommonOptions) {}

  private markStarted = (): void => {
    if (this.o.session.started) return;
    this.o.session = { id: this.o.session.id, started: true };
    this.o.onSessionStarted(this.o.session);
  };

  async turn(message: string, emit: (e: Event) => void, signal: AbortSignal, profile?: ModelProfile): Promise<void> {
    try {
      profileArgs(profile);
    } catch (err) {
      // No ErrorCode fits a profile the core built wrong (it is not the plan's model, nor the user's
      // quota): agent-crashed is the generic "this turn could not run" card. The shell cleans every profile
      // first, so this is a last guard that should never show.
      emit(fail("agent-crashed", err instanceof Error ? err.message : String(err)));
      return;
    }
    const wasResume = this.o.session.started;
    let last = await this.attempt(message, emit, signal, profile);
    if (wasResume && last.type === "done" && !last.ok && last.error?.detail && NO_CONVERSATION.test(last.error.detail) && !signal.aborted) {
      // The stored session is gone on the CLI side: continue the chat in a fresh one.
      this.o.session = { id: randomUUID(), started: false };
      last = await this.attempt(message, emit, signal, profile);
      if (last.type === "done" && last.ok) this.markStarted();
    }
    emit(last);
  }

  /** Runs one process; resolves with the terminal event instead of emitting it. */
  private attempt(message: string, rawEmit: (e: Event) => void, signal: AbortSignal, profile: ModelProfile | undefined): Promise<Event> {
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
      const child = spawn(binary, [...leading, ...claudeArgs({ ...this.o, profile })], {
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
        else if (reader.modelUnavailable) finish(fail("model-unavailable", reader.resultError ?? "model_not_found"));
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
