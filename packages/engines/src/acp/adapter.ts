import type { EngineAdapter } from "../contract";
import type { EngineDef, TransportDef } from "../types";
import { AcpTransport } from "./client";
import { acpFields } from "./options";

function acpDef(engine: EngineDef): Extract<TransportDef, { kind: "acp" }> {
  if (engine.transport.kind !== "acp") throw new Error(`Not an ACP engine: ${engine.id}`);
  return engine.transport;
}

/** Any engine that speaks the Agent Client Protocol: everything that differs between them is data in the definition. */
export const acpAdapter: EngineAdapter = {
  capabilities: { forkSession: false, nativeMemory: false, noBuiltins: false },
  command: (engine) => [...acpDef(engine).command],
  createTransport: (engine, options) =>
    new AcpTransport({
      ...options,
      ...acpFields(engine, options.permissions.edit),
      // Codex reads CODEX_CONFIG by name: only it takes an engine preset's codex part (hatches §5). Other ACP engines
      // (Kimi, Gemini, Qwen) leave the method unset in their definition, and Codex's definition is pinned as it is.
      // Without a preset on the turn the value changes nothing (D0).
      ...(engine.id === "codex" ? { profileMethod: "codex-config" as const } : {}),
    }),
};
