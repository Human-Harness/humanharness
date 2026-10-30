import type { EngineAdapter } from "../contract";
import { ClaudeCliTransport } from "./transport";

/** Claude Code's CLI: one `claude -p` process per turn (docs/architecture/engines.md). */
export const claudeAdapter: EngineAdapter = {
  capabilities: { forkSession: false, nativeMemory: false, noBuiltins: true },
  command: (engine) => {
    if (engine.transport.kind !== "claude-cli") throw new Error(`Not a Claude CLI engine: ${engine.id}`);
    return [engine.transport.binary];
  },
  createTransport: (_engine, options) => new ClaudeCliTransport(options),
};
