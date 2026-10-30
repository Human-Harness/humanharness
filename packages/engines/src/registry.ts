import { acpAdapter } from "./acp/adapter";
import { claudeAdapter } from "./claude/adapter";
import type { CommonOptions, EngineAdapter, Transport } from "./contract";
import type { EngineDef } from "./types";

// The transport classes, for tests that check or spy on which one an engine got.
export { AcpTransport } from "./acp/client";
export type { TransportOptions } from "./acp/options";
export { ClaudeCliTransport } from "./claude/transport";
// A linked folder whose path no Claude permission rule can spell is refused when it is picked (hatches §3.2).
export { ruleUnsafePath } from "./claude/transport";

/** One line per engine. Codex, OpenCode and the engines listed only for their legal status run the ACP adapter. */
export const ADAPTERS: Readonly<Record<string, EngineAdapter>> = {
  claude: claudeAdapter,
  codex: acpAdapter,
  opencode: acpAdapter,
  kimi: acpAdapter,
  gemini: acpAdapter,
  qwen: acpAdapter,
};

export interface Registry {
  adapter(engine: EngineDef): EngineAdapter;
  createTransport(engine: EngineDef, options: CommonOptions): Transport;
  commandLine(engine: EngineDef): string[];
}

/** A registry over `adapters`; the app uses `ADAPTERS`, a test may add its own engine. */
export function createRegistry(adapters: Readonly<Record<string, EngineAdapter>>): Registry {
  const adapter = (engine: EngineDef): EngineAdapter => {
    const found = adapters[engine.id];
    if (!found) throw new Error(`No adapter for engine: ${engine.id}`);
    return found;
  };
  return {
    adapter,
    createTransport: (engine, options) => adapter(engine).createTransport(engine, options),
    commandLine: (engine) => adapter(engine).command(engine),
  };
}

export const registry: Registry = createRegistry(ADAPTERS);
export const createTransport = registry.createTransport;
export const commandLine = registry.commandLine;
