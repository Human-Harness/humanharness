// The documents mod's agent side as runtime options, for tests that run a runtime with no mod host: the writing guide,
// and the review tools when there is a `review` handler and the agent may edit.
import { type LoadedHarness, documentsConfig } from "@humanharness/harness-sdk";
import { documentsAgent } from "../../mods/documents/src/main/agent";
import type { AgentToolSet } from "../src";

export function reviewAgent(harness: LoadedHarness, review?: (request: unknown) => Promise<unknown>): { instructions: () => string[][]; agentTools?: AgentToolSet } {
  const agent = documentsAgent(async (_folder, request) => review!(request));
  const info = { canEdit: review !== undefined && harness.permissions.edit === "folder", folder: "", documentKinds: documentsConfig(harness)?.kinds ?? {} };
  const lines = agent.instructions(info);
  const tools = agent.agentTools(info);
  if (tools.length === 0) return { instructions: () => [lines] };
  return {
    instructions: () => [lines],
    agentTools: {
      definitions: tools.map(({ handle: _, ...definition }) => definition),
      handle: async (tool, args) => tools.find((t) => t.name === tool)?.handle(args),
    },
  };
}
