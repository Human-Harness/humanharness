import fs from "node:fs";
import path from "node:path";
import type { McpServerSpec } from "@humanharness/blocks";
import type { Effort, EngineDef, ModelChoice, ModelProfile } from "@humanharness/engines";
import type { Permissions } from "@humanharness/harness-sdk";
import type { Event } from "./events";

export interface Session {
  id: string;
  /** False until the engine has created the session; then turns resume it. */
  started: boolean;
}

export interface TransportOptions {
  folder: string;
  session: Session;
  mcp: McpServerSpec[];
  permissions: Permissions;
  /** Folders the agent may read but never change (absolute paths). */
  references?: string[];
  /** ACP only: session mode to set after session/new|load (e.g. "workspace-write"). */
  sessionMode?: string;
  /** ACP only: fail with `outdated-version` if the adapter reports an older agentInfo.version. */
  minAdapterVersion?: string;
  /**
   * ACP only: how a turn's model profile reaches the agent. `codex-config` (default): `CODEX_CONFIG` at spawn, a
   * new process when it changes. `config-option`: `session/set_config_option` on the open session (OpenCode).
   */
  profileMethod?: "codex-config" | "config-option";
  /** ACP only: the engine's fixed environment (registry `transport.env`, OpenCode only), set over the inherited one and `env`. */
  engineEnv?: Record<string, string>;
  /**
   * Only the MCP servers, no file reading at all (language spec §5): Claude gets no Read, Glob, Grep or TodoWrite,
   * and ACP read and search requests are refused. Off for tasks and material (D0).
   */
  mcpOnly?: boolean;
  /**
   * Claude only, an AI step's slot (tools spec §7.1, R1): `--tools ""` on top of mcpOnly, so no built-in tool reaches
   * the turn, not even one a later CLI adds that reads without asking. Absent everywhere else (D0: argv as before).
   */
  noBuiltins?: boolean;
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

/**
 * The ACP fields of an engine's transport options: the mode for the harness's edit permission, the adapter gate,
 * the profile method, and the engine's fixed environment (only when the registry sets one: Codex gets none, D0).
 */
export function acpFields(
  engine: EngineDef,
  edit: Permissions["edit"],
): Pick<TransportOptions, "sessionMode" | "minAdapterVersion" | "profileMethod" | "engineEnv"> {
  const t = engine.transport;
  if (t.kind !== "acp") return { sessionMode: undefined, minAdapterVersion: undefined, profileMethod: undefined };
  return {
    sessionMode: t.modes?.[edit === "folder" ? "edit" : "readOnly"],
    minAdapterVersion: t.minAdapterVersion,
    profileMethod: t.profile,
    ...(t.env ? { engineEnv: { ...t.env } } : {}),
  };
}

/** Where a preset turn's PATH falls back when no entry is left: an empty PATH would search the current folder. */
export const FALLBACK_SEARCH_PATH = "/usr/bin:/bin";

/**
 * `p`'s real path, spelled as on disk; for a path that doesn't exist (yet), its deepest existing folder's real path
 * with the rest appended. Compared without case and Unicode form below, so a folder created later can't slip by.
 */
function placed(p: string): string {
  let head = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...rest.reverse());
    } catch {
      const up = path.dirname(head);
      if (up === head) return path.resolve(p);
      rest.push(path.basename(head));
      head = up;
    }
  }
}

const fold = (p: string) => p.normalize("NFC").toLowerCase();

/**
 * A preset turn's `PATH`: the absolute entries that lie outside every root (the work folder and the scope's linked
 * folders), each placed by its real path. An empty, `.` or relative entry would search the current folder, and one
 * inside a root a folder the agent writes: either could answer for `node`, `npx`'s `#!/usr/bin/env node` or a hook's
 * interpreter (hatches spec §5.3, E2). When nothing is left, `/usr/bin:/bin`. Applied on turns with an engine preset
 * only: without one the environment stays as it was (D0).
 */
export function absoluteSearchPath(value: string, roots: readonly string[] = []): string {
  const rootsAt = roots.map((r) => fold(placed(r)));
  const kept = value.split(":").filter((d) => {
    if (!d.startsWith("/")) return false;
    const at = fold(placed(d));
    return !rootsAt.some((r) => at === r || at.startsWith(r.endsWith("/") ? r : `${r}/`));
  });
  return kept.length > 0 ? kept.join(":") : FALLBACK_SEARCH_PATH;
}
