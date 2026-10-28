import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "@humanharness/harness-sdk";
import { RpcRefused, RpcTimeout, callRpc } from "./bridge";

/**
 * Bounds of one save (spec §5: batches of about 100 keys); the app checks every key again. `total` caps all the texts
 * together, so even fully escaped the request stays under the rpc channel's line limit.
 */
export const SAVE_LIMITS = { keys: 150, key: 200, text: 4000, total: 120_000 } as const;
const text = z.string().max(SAVE_LIMITS.text);
const forms = z.object({ zero: text, one: text, two: text, few: text, many: text, other: text }).partial().strict();
const textLength = (v: string | Record<string, string | undefined>) =>
  typeof v === "string" ? v.length : Object.values(v).reduce((n, s) => n + (s?.length ?? 0), 0);
const strings = z
  .record(z.string().min(1).max(SAVE_LIMITS.key), z.union([text, forms]))
  .refine((o) => Object.keys(o).length <= SAVE_LIMITS.keys, `At most ${SAVE_LIMITS.keys} keys per call`)
  .refine((o) => Object.values(o).reduce((n, v) => n + textLength(v), 0) <= SAVE_LIMITS.total, `At most ${SAVE_LIMITS.total} characters per call`);

/**
 * What the agent reads when a save didn't go through. A timeout gets its own text: the app may have saved the batch
 * after all, so calling again could only be refused as already answered.
 */
export function saveErrorText(e: unknown): string {
  if (e instanceof RpcTimeout) return "The app did not answer in time; it may have saved this batch. Do not call again.";
  const message = e instanceof Error ? e.message : String(e);
  return e instanceof RpcRefused ? `Refused: ${message}` : `Could not reach the app (${message}). Do not retry in a loop.`;
}

/**
 * The `translate` MCP server (language spec §5): one tool, `save_translation`, that hands the batch's map to the app over
 * `rpc` as `{ op: "save", strings }`. The server keeps nothing; the app validates and caches.
 */
export function createTranslateServer(rpc: { path: string; token: string }): McpServer {
  const server = new McpServer({ name: "translate", version: "0.1.0" });
  server.registerTool(
    "save_translation",
    {
      description:
        "Saves this batch's translations: an object from each key you were given to its translated text (for a plural key, an object of the forms you were asked for). Call it once per batch.",
      inputSchema: { strings },
    },
    async (args) => {
      try {
        const result = await callRpc(rpc, { op: "save", strings: args.strings }, 30_000);
        return { content: [{ type: "text" as const, text: typeof result === "string" ? result : JSON.stringify(result) }] };
      } catch (e) {
        return { isError: true, content: [{ type: "text" as const, text: saveErrorText(e) }] };
      }
    },
  );
  return server;
}
