import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { jsonSchemaToZod } from "@humanharness/harness-sdk";
import { RpcRefused, RpcTimeout, callRpc } from "./bridge";

/** A tool the caller adds to the `ui` server, as data: the server lists it and sends each call back to the caller. */
export interface AgentToolDefinition {
  name: string;
  description: string;
  /** The arguments' JSON Schema, of `type: "object"`, in the subset `jsonSchemaToZod` takes. Undeclared keys are dropped. */
  inputSchema: Record<string, unknown>;
  /** Only in a task's slot: a job can't ask the person (parallel spec §8, J1). */
  tasksOnly?: boolean;
  /** What the agent reads when the app does not answer in time. */
  timeoutError?: string;
}

/** The caller's tools and the one handler that answers them. */
export interface AgentToolSet {
  definitions: readonly AgentToolDefinition[];
  /** `tool` is one of the definitions offered to the asking slot. A thrown message reaches the agent as it is. */
  handle: (tool: string, args: Record<string, unknown>) => Promise<unknown>;
}

/** One call, as the `ui` server sends it over the tools channel: the arguments never choose the tool. */
export interface AgentToolCall {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * What the agent reads when a call fails: the app's own refusal, or a fixed line (never a socket path or another
 * error's text).
 */
export function agentToolError(e: unknown, timeoutError = "The app did not answer. Do not retry in a loop."): string {
  if (e instanceof RpcRefused) return e.message;
  if (e instanceof RpcTimeout) return timeoutError;
  return "Could not reach the app. Nothing was saved; do not retry in a loop.";
}

/** Lists each definition as a tool; each call is a request the app answers, and a refusal comes back as a tool error. */
export function addAgentTools(server: McpServer, definitions: readonly AgentToolDefinition[], rpc: { path: string; token: string }): void {
  for (const { name, description, inputSchema, timeoutError } of definitions) {
    server.registerTool(name, { description, inputSchema: jsonSchemaToZod(inputSchema) }, async (args: unknown) => {
      try {
        const call: AgentToolCall = { tool: name, args: args as Record<string, unknown> };
        const result = await callRpc(rpc, call);
        return { content: [{ type: "text" as const, text: JSON.stringify(result ?? null) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: agentToolError(e, timeoutError) }] };
      }
    });
  }
}
