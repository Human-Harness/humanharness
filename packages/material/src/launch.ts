import { fileURLToPath } from "node:url";
import type { Launcher, McpServerSpec } from "@humanharness/blocks";

/** The `material` MCP server (§9, §10): its tools ask the app over `rpc`. */
export function materialServerSpec(o: {
  rpc: { path: string; token: string };
  launcher: Launcher;
  mode: "person" | "system";
  /** System mode: the stage's tools. */
  tools?: readonly string[];
  /** Built entry (app); defaults to the TS source (dev). */
  entry?: string;
}): McpServerSpec {
  const entry = o.entry ?? fileURLToPath(new URL("./server-bin.ts", import.meta.url));
  return {
    name: "material",
    command: o.launcher.command,
    args: [...o.launcher.args, entry],
    env: { ...o.launcher.env, HH_RPC: o.rpc.path, HH_RPC_TOKEN: o.rpc.token, HH_MATERIAL_MODE: o.mode, HH_MATERIAL_TOOLS: (o.tools ?? []).join(",") },
  };
}
