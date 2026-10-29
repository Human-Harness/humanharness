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
  capabilities: { forkSession: false, nativeMemory: false },
  command: (engine) => [...acpDef(engine).command],
  createTransport: (engine, options) => new AcpTransport({ ...options, ...acpFields(engine, options.permissions.edit) }),
};
