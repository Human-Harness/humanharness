import { isDeepStrictEqual } from "node:util";
import type { AgentToolSet } from "@humanharness/blocks";
import { JOB_RESULT_TOOL, type LoadedHarness, STEP_OUTPUT_TOOL, allBlocks, blockToolName } from "@humanharness/harness-sdk";
import type { TurnEndInfo } from "@humanharness/mod-sdk";
import type { TurnEnd } from "../task-manager";
import { modOff, modReloaded } from "./agent-answers";
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
 * The agent side a runtime gets (`RuntimeOptions.instructions` and `agentTools`): the sections and tools of the mods
 * that are on, in the host's order (spec §4.2). `folder` is the one the runtime works in. `mods` is the host running
 * when asked (the instructions on each write, the tools on each session): without one, as with no mod that registered
 * these hooks, there are none (D0).
 */
export function withModAgent(
  harness: LoadedHarness,
  folder: string,
  mods: () => Pick<ModHost, "instructions" | "agentTools" | "view"> | null,
): { instructions: () => Promise<string[][]>; agentTools: () => Promise<AgentToolSet | undefined> } {
  const info = { canEdit: harness.permissions.edit === "folder", folder, documentKinds: harness.documents?.kinds ?? {} };
  return {
    instructions: async () => (await mods()?.instructions(info)) ?? [],
    agentTools: async () => {
      // Every tool of the `ui` server shares one list of names.
      const blocks = Object.entries(allBlocks(harness)).map(([name, block]) => blockToolName(name, block));
      const taken = [...blocks, JOB_RESULT_TOOL, STEP_OUTPUT_TOOL];
      const host = mods();
      const added = (await host?.agentTools(info, taken)) ?? [];
      if (added.length === 0) return undefined;
      /** The tools of the host running now, when it isn't the one this session's came from. */
      let rebuilt: { host: ReturnType<typeof mods>; tools: ReturnType<ModHost["agentTools"]> } | undefined;
      // `restartModHost` stops the host and builds another: the same mod's same tool there answers, so a mod that is
      // still on keeps working until the next session.
      const call = async ({ handle, ...bound }: (typeof added)[number], args: Record<string, unknown>) => {
        const now = mods();
        if (now === host) return handle(args);
        if (!now) throw modOff(bound.mod);
        if (rebuilt?.host !== now) rebuilt = { host: now, tools: now.agentTools(info, taken) };
        const same = (await rebuilt.tools).find(({ handle: _, ...t }) => isDeepStrictEqual(t, bound));
        if (same) return same.handle(args);
        // Asked again next time: the new host may still be loading its mods.
        rebuilt = undefined;
        throw now.view().some((m) => m.id === bound.mod && m.on) ? modReloaded(bound.mod) : modOff(bound.mod);
      };
      return {
        definitions: added.map(({ handle: _, mod: __, ...definition }) => definition),
        handle: async (tool, args) => {
          const mod = added.find((t) => t.name === tool);
          return mod ? call(mod, args) : undefined;
        },
      };
    },
  };
}
