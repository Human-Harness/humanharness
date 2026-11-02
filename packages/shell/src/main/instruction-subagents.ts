import type { RuntimeOptions } from "@humanharness/runtime";
import type { TaskPreset } from "./engine-config/engine-host";

export interface InstructionSubagentsDeps {
  /** The engine host; undefined without `enginePresets` (D0: nothing is read). */
  engineHost: () => { presetFor(scope: string, action: string | undefined): Promise<TaskPreset> } | undefined;
  /** The open scope, null when none is open. */
  currentScope: () => Promise<string | null>;
  /** Board mode lists nothing for the open scope, as the linked folders do. */
  boardMode: () => boolean;
}

/**
 * Whether the open scope's engine preset ships an `agentsFile` (the managed AGENTS.md's `### Subagents` part,
 * `RuntimeOptions.instructionSubagents`). The manifest's `permissions.subagents` is decided by the runtime first.
 * Any failure counts as no.
 */
export function instructionSubagentsOption(d: InstructionSubagentsDeps): NonNullable<RuntimeOptions["instructionSubagents"]> {
  return async () => {
    if (d.boardMode()) return false;
    const host = d.engineHost();
    if (!host) return false;
    try {
      const scope = await d.currentScope();
      if (!scope) return false;
      return !!(await host.presetFor(scope, undefined)).preset?.agentsFile;
    } catch (err) {
      console.error("Could not read the open scope's engine preset for AGENTS.md", err);
      return false;
    }
  };
}
