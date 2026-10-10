import type { McpServerSpec } from "@humanharness/blocks";
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
  /** The CLI to run: [binary, ...leading args]. */
  command: string[];
  /** Extra environment for the CLI (tests and dev only; never credentials). */
  env?: Record<string, string>;
  onSessionStarted: (session: Session) => void;
}

export interface Transport {
  /** Runs one turn. Emits events and always finishes with exactly one `done` event before resolving. */
  turn(message: string, emit: (event: Event) => void, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
