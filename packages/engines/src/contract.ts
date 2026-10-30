import type { McpServerSpec } from "@humanharness/blocks";
import type { Permissions } from "@humanharness/harness-sdk";
import type { Effort, ModelChoice, ModelProfile } from "./models";
import type { EngineDef } from "./types";

export type ActivityKind = "read" | "edit" | "search" | "web" | "exec" | "other";

export type ErrorCode =
  | "engine-not-installed"
  | "session-expired"
  | "out-of-quota"
  | "agent-crashed"
  | "cancelled"
  | "outdated-version"
  /** The user hasn't accepted the engine's legal notice (at its current version) in this app. */
  | "notice-required"
  /** The plan doesn't include the model the task asked for (resources spec §5.3). */
  | "model-unavailable"
  /** A required pre-step failed: the task didn't start (tools spec §6.5). */
  | "prepare-failed";

export interface EngineError {
  code: ErrorCode;
  detail?: string;
}

/** One plan-limit window as reported by the engine (e.g. Claude's five_hour / seven_day). */
export interface LimitWindow {
  kind: string;
  /** 0..1 share of the window already used. */
  utilization: number;
  /** ISO timestamp when the window resets. */
  resetsAt: string;
}

/** The longest edit path kept from an engine: longer names no real file, only a big string held in main. */
export const EDIT_PATH_MAX = 4096;

/**
 * A line the app adds to a task's chat in board mode, never an engine's: another task also changed these paths
 * (parallel spec §5.3; `other` names it, absent when it has ended; `paths` the first few, `more` the rest), or the
 * earlier engine session couldn't be loaded and a new one started (PT-S4).
 */
export type TaskNotice = { kind: "conflict"; paths: string[]; more?: number; other?: string; ended?: true } | { kind: "resume-failed" };

/** A Markdown file a turn added or changed (document-reader spec §5.1): what its card shows. */
export interface DocumentCard {
  /** Relative to the folder, forward slashes. */
  path: string;
  title: string;
  /** Front-matter `kind`, when there is one. */
  kind?: string;
  change: "new" | "updated";
  /** Words in the body; the window turns them into a reading time. */
  words: number;
}

/** One harness tool call as the chat's folded line shows it (tools spec §8.2). */
export interface ToolCallView {
  tool: string;
  caller: "ui" | "agent" | "pre" | "job";
  ok: boolean;
  ms: number;
  summary: string;
  error?: string;
  /** Cut at 2 KB each. */
  args: string;
  result?: string;
  accesses: { kind: "fetch" | "exec" | "data" | "files"; target: string; allowed: boolean }[];
  /** The tool's `ctx.log` lines, keys hidden; absent when it logged none. */
  logs?: { level: "info" | "warn" | "error"; message: string }[];
  /** A trace note, not a call (a pre-step's cut, an expected tool not called); one line, at most 200 characters. */
  note?: string;
  at: string;
}

/** Normalized events every transport emits. Each turn ends with exactly one `done`. */
export type Event =
  | { type: "text"; delta: string }
  | { type: "paragraph" }
  /**
   * `paths`: what a read or search tool named (as the engine reported them, usually absolute), on the start event only.
   * `tool`: an MCP tool's server and name (never the core's `ui`), on the start event only. Both are for the task
   * manager's context record (context-panel spec §3.2); the window never gets them.
   * `edits`: the files an edit tool named (absolute or as the engine wrote them), on the start event only. For the
   * history's attribution (parallel spec §5.2); the window and the chat log never get them (shell `forWindow`).
   * Only a hint: an engine that writes through the shell names no file.
   */
  | {
      type: "activity";
      id: string;
      kind: ActivityKind;
      detail: string;
      state: "start" | "end";
      error?: boolean;
      paths?: string[];
      tool?: { server: string; name: string };
      edits?: string[];
    }
  /** `id`: set by the app on a block the person answers (input-blocks spec §4), never by an engine. */
  | { type: "block"; name: string; data: unknown; id?: string }
  | { type: "limits"; status: string; windows: LimitWindow[] }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      cacheWriteTokens: number;
      /** API-equivalent cost when the engine reports it. Not what the user pays. */
      costEquivalentUsd?: number;
      /** Real money the provider charged for this turn, in USD (OpenCode). Absent when the engine reports no cost. */
      costUsd?: number;
      /** The model the engine says it ran (Claude: system/init; Codex: currentModelId without its effort). */
      model?: string;
    }
  /** Context in use after the turn, in tokens, and the window when the engine reports it (spec §6). */
  | { type: "context"; used: number; size?: number }
  /** The engine compacted the conversation during the turn. */
  | { type: "compaction" }
  /** Board mode only, from the app (never a transport): a notice for the task's chat, shown as a system line (D0: none). */
  | { type: "task-notice"; notice: TaskNotice }
  /** The turn's added or changed `.md` files, sent right before a successful `done`. Never empty. */
  | { type: "documents"; documents: DocumentCard[] }
  /** From the app (never a transport), only for a harness with tools: one tool call of the task (tools spec §8.2). */
  | { type: "tool-call"; call: ToolCallView }
  | { type: "done"; ok: true }
  | { type: "done"; ok: false; error: EngineError };

export function fail(code: ErrorCode, detail?: string): Event {
  return { type: "done", ok: false, error: detail ? { code, detail } : { code } };
}

export interface Session {
  id: string;
  /** False until the engine has created the session; then turns resume it. */
  started: boolean;
}

/** What every engine's transport takes (spec §4.3). Engine-only fields are derived by the engine's adapter. */
export interface CommonOptions {
  folder: string;
  session: Session;
  mcp: McpServerSpec[];
  permissions: Permissions;
  /** Folders the agent may read but never change (absolute paths). */
  references?: string[];
  /**
   * Only the MCP servers, no file reading at all (language spec §5): Claude gets no Read, Glob, Grep or TodoWrite,
   * and ACP read and search requests are refused. Off for tasks and material (D0).
   */
  mcpOnly?: boolean;
  /** Claude only: false runs the CLI with `--no-session-persistence` (one-off turns such as the setup test). */
  persistSession?: boolean;
  /**
   * The Sidekick session (sidekick spec §5): no tools at all. Claude gets `--tools ""` and every built-in denied;
   * it must come with no MCP servers and no reference folders. ACP sessions get no MCP servers and the read-only mode.
   */
  noTools?: boolean;
  /** The CLI to run: [binary, ...leading args]. */
  command: string[];
  /** Extra environment for the CLI (tests and dev only; never credentials). */
  env?: Record<string, string>;
  onSessionStarted: (session: Session) => void;
  /** ACP only: the models and efforts the agent offered at session/new (saved for Settings › Modelos). */
  onModels?: (offer: { models: ModelChoice[]; efforts: Effort[] }) => void;
  /** ACP: the adapter can't take linked folders (hatches §3.3); called once per transport. */
  onLinkedUnsupported?: () => void;
}

/** A folder of the turn's scope the agent may reach (hatches spec §3.3). `path` is absolute and real. */
export interface LinkedAccess {
  path: string;
  mode: "read" | "write";
  /** The core history tracks it (no git): the workspace commits and restores it with the folder (§3.4). */
  tracked: boolean;
}

/**
 * A scope's approved engine config, read from its snapshot in the app's data folder, never the live folder (hatches
 * spec §5.2). Every path is absolute.
 */
export interface EnginePreset {
  /** The approved hash the snapshot is keyed by. */
  hash: string;
  /** `global` also loads the person's own engine config (Claude: user settings and their MCP servers). */
  base: "isolated" | "global";
  /** Cleaned settings: hooks and permissions allow/deny/ask only. */
  settings?: { hooks?: Record<string, unknown>; permissions?: { allow?: string[]; deny?: string[]; ask?: string[] } };
  /** The preset's MCP servers, already named `scope-<name>`. */
  servers: McpServerSpec[];
  /**
   * The snapshot folder laid out as a plugin (`skills/<name>/SKILL.md`, no manifest); absent without skills. Claude
   * names a plugin without a manifest after its folder, so the skills are `/<basename>:<name>`.
   */
  pluginDir?: string;
  /** agents.json in the snapshot; absent without agents. */
  agentsFile?: string;
  /** Codex: the cleaned codex.toml as JSON. */
  codex?: Record<string, unknown>;
}

/** What a turn gets from its task's scope (hatches spec §3, §5). Absent: nothing, as before (D0). */
export interface TurnScope {
  linked: LinkedAccess[];
  /** The scope's approved engine preset (part 3); absent without one (D0). */
  engine?: EnginePreset;
}

export interface Transport {
  /**
   * Runs one turn. Emits events and always finishes with exactly one `done` event before resolving.
   * `profile` is the task's model, effort and context cap (resources spec §5.2); absent: the engine's defaults.
   * `scope`: the task's scope's linked folders (hatches); absent for a harness without them (D0).
   */
  turn(message: string, emit: (event: Event) => void, signal: AbortSignal, profile?: ModelProfile, scope?: TurnScope): Promise<void>;
  /** Ends the current engine session; the next turn starts a new one. Never called during a turn. */
  endSession(): Promise<void>;
  close(): Promise<void>;
}

/** What an engine can do beyond a turn, for policies to ask (spec §7.2). */
export interface Capabilities {
  /** A new session can start as a copy of another (a warm prefix). */
  forkSession: boolean;
  /** The engine keeps its own memory across sessions. */
  nativeMemory: boolean;
}

/**
 * Everything engine-specific the app needs beyond the definition (spec §4.2). It is given the definition rather
 * than holding one, so a test's copy of a definition is read as given.
 */
export interface EngineAdapter {
  capabilities: Capabilities;
  /** The engine's CLI before the app looks it up on PATH: [binary, ...args]. */
  command(engine: EngineDef): string[];
  /** A transport for `engine`; the adapter adds its own fields to the common options. */
  createTransport(engine: EngineDef, options: CommonOptions): Transport;
}
