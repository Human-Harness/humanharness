import type { Permissions } from "@humanharness/harness-sdk";
import type { CommonOptions } from "../contract";
import type { EngineDef } from "../types";

/** The ACP transport's options: the common ones plus the fields only ACP engines have. */
export interface TransportOptions extends CommonOptions {
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
