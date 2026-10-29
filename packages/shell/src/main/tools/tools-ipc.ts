import { TOOL_ID } from "@humanharness/harness-sdk";
import type { ToolCallResult, ToolCallView } from "@humanharness/ui/client";
import { isTaskId } from "@humanharness/workspace";
import type { ToolsHost } from "./tools-host";

/** `client.tools` (tools spec §5). Registered only when the harness declares tools (D0). */
export const TOOLS_IPC_CHANNELS = ["hh:toolsCall", "hh:toolsTrace"] as const;
/** Main to the window: the tools info changed (`ToolsInfo`; sent only when the harness declares tools). */
export const TOOLS_CHANGE_CHANNEL = "hh:toolsChange";

type Handle = (channel: string, fn: (...args: never[]) => unknown) => void;

/** A UI call's arguments, as JSON, at most this many bytes. */
export const TOOLS_IPC_ARGS_MAX_BYTES = 1024 * 1024;
const INVALID: ToolCallResult = { ok: false, error: "Invalid request" };
const WRONG: ToolCallResult = { ok: false, error: "Something went wrong running the tool" };

/** The arguments' JSON size, or null when they are not JSON or too large. */
function argsOk(args: unknown): boolean {
  if (args === undefined) return true;
  let json: string | undefined;
  try {
    json = JSON.stringify(args);
  } catch {
    return false;
  }
  return json !== undefined && Buffer.byteLength(json, "utf8") <= TOOLS_IPC_ARGS_MAX_BYTES;
}

/**
 * Through index.ts's handle(), which answers only the app's page (T9): the page names a tool and its arguments, never a
 * caller, task or scope. Every call runs as the UI in the scope main has open; a malformed request is refused before
 * the registry, and a failure answers a fixed text.
 */
export function registerToolsIpc(handle: Handle, host: Pick<ToolsHost, "uiCall" | "trace">): void {
  handle("hh:toolsCall", (id: unknown, args: unknown): Promise<ToolCallResult> | ToolCallResult =>
    typeof id !== "string" || !TOOL_ID.test(id) || !argsOk(args) ? INVALID : host.uiCall(id, args).catch(() => WRONG),
  );
  // A task id or a job run's id (both pass isTaskId): never a path.
  handle("hh:toolsTrace", (id: unknown): Promise<ToolCallView[]> | ToolCallView[] => (isTaskId(id) ? host.trace(id).catch(() => []) : []));
}
