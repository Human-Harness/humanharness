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
}

export interface Transport {
  /**
   * Runs one turn. Emits events and always finishes with exactly one `done` event before resolving.
   * `profile` is the task's model, effort and context cap (resources spec §5.2); absent: the engine's defaults.
   */
  turn(message: string, emit: (event: Event) => void, signal: AbortSignal, profile?: ModelProfile): Promise<void>;
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
