import type { AgentToolSet } from "@humanharness/blocks";
import { JOB_RESULT_TOOL, type LoadedHarness, STEP_OUTPUT_TOOL, allBlocks, blockToolName } from "@humanharness/harness-sdk";
import type { TurnEndInfo } from "@humanharness/mod-sdk";
import type { TurnEnd } from "../task-manager";
import type { ModHost } from "./host";

/** D0: the host exists only if some mod could run. Settings › Mods still shows (empty) without one. */
export const needsHost = (o: { declared: Record<string, unknown> | undefined; local: string[]; coreIds: string[] }) =>
  Object.keys(o.declared ?? {}).length > 0 || o.local.length > 0 || o.coreIds.length > 0;

/** A task-manager turn end as a mod's `turnEnd` payload: the same, without the kind. */
export function toTurnEnd(e: TurnEnd): TurnEndInfo {
  const { kind: _kind, ...rest } = e;
  return rest;
}

/**
 * The agent side a runtime gets (`RuntimeOptions.instructions` and `agentTools`): the app's own sections and tools,
 * then the mods' in mod order (spec §4.2). `mods` is the host running when asked (the instructions on each write, the
 * tools on each session): without one, as with no mod that registered these hooks, it is the app's own alone (D0).
 */
export function withModAgent(
  core: { instructions: () => string[][]; agentTools?: AgentToolSet },
  harness: LoadedHarness,
  mods: () => Pick<ModHost, "instructions" | "agentTools"> | null,
): { instructions: () => Promise<string[][]>; agentTools: () => Promise<AgentToolSet | undefined> } {
  const info = { canEdit: harness.permissions.edit === "folder" };
  return {
    instructions: async () => [...core.instructions(), ...((await mods()?.instructions(info)) ?? [])],
    agentTools: async () => {
      const own = core.agentTools;
      // Every tool of the `ui` server shares one list of names.
      const blocks = Object.entries(allBlocks(harness)).map(([name, block]) => blockToolName(name, block));
      const taken = [...blocks, JOB_RESULT_TOOL, STEP_OUTPUT_TOOL, ...(own?.definitions.map((d) => d.name) ?? [])];
      const added = (await mods()?.agentTools(info, taken)) ?? [];
      if (added.length === 0) return own;
      return {
        definitions: [...(own?.definitions ?? []), ...added.map(({ handle: _, ...definition }) => definition)],
        handle: async (tool, args) => {
          const mod = added.find((t) => t.name === tool);
          return mod ? mod.handle(args) : own?.handle(tool, args);
        },
      };
    },
  };
}
