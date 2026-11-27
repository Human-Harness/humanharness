import { jsonSchemaToZod } from "@humanharness/harness-sdk";
import type { AgentTool } from "@humanharness/mod-sdk";

/** What the host takes from a mod's agent hooks: the `ui` server must be able to take whatever passes here. */

/** Why a call of a tool the agent's session still lists is refused. */
export const modOff = (id: string) => new Error(`Mod "${id}" is off`);
export const modReloaded = (id: string) => new Error(`Mod "${id}" was reloaded: its tools are in the next session`);

export const isLines =(v: unknown): v is string[] => Array.isArray(v) && v.every((line) => typeof line === "string");

const TOOL_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/;
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Why `t` can't be listed as a tool beside the `taken` names, or null. */
function toolProblem(t: unknown, taken: ReadonlySet<string>): string | null {
  if (!isRecord(t)) return "a tool must be an object";
  const name = t.name;
  // The MCP SDK keeps its tools in a plain object: a name it already has ("constructor") would stop the whole server.
  if (typeof name !== "string" || !TOOL_NAME.test(name) || name in Object.prototype) return `"${String(name)}" is not a tool name`;
  if (taken.has(name)) return `the name "${name}" is taken`;
  if (typeof t.description !== "string" || !t.description) return `"${name}" needs a description`;
  if (typeof t.handle !== "function") return `"${name}" needs a handle function`;
  if (!isRecord(t.inputSchema) || t.inputSchema.type !== "object") return `"${name}" needs an inputSchema of type "object"`;
  try {
    jsonSchemaToZod(t.inputSchema);
    // It travels to the `ui` server as JSON.
    JSON.stringify(t.inputSchema);
  } catch (err) {
    return `"${name}": ${err instanceof Error ? err.message : String(err)}`;
  }
  if (t.tasksOnly !== undefined && typeof t.tasksOnly !== "boolean") return `"${name}": tasksOnly must be true or false`;
  if (t.timeoutError !== undefined && typeof t.timeoutError !== "string") return `"${name}": timeoutError must be a text`;
  return null;
}

/** An `agentTools()` answer: the tools it can add, and why the first one left out can't be. */
export function readAgentTools(value: unknown, taken: ReadonlySet<string>): { tools: AgentTool[]; problem?: string } {
  if (!Array.isArray(value)) return { tools: [], problem: "agentTools() must return a list of tools" };
  const names = new Set(taken);
  const tools: AgentTool[] = [];
  let problem: string | undefined;
  for (const t of value as unknown[]) {
    const why = toolProblem(t, names);
    if (why !== null) {
      problem ??= `agentTools(): ${why}`;
      continue;
    }
    const tool = t as AgentTool;
    names.add(tool.name);
    tools.push(tool);
  }
  return { tools, ...(problem !== undefined ? { problem } : {}) };
}
