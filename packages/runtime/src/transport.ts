import type { McpServerSpec } from "@humanharness/blocks";
import type { ModelProfile } from "@humanharness/engines";
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
  /** Claude only: false runs the CLI with `--no-session-persistence` (one-off turns such as the setup test). */
  persistSession?: boolean;
  /** The CLI to run: [binary, ...leading args]. */
  command: string[];
  /** Extra environment for the CLI (tests and dev only; never credentials). */
  env?: Record<string, string>;
  onSessionStarted: (session: Session) => void;
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
