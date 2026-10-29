/**
 * What a harness's tool file imports (`import { defineTool, z } from "@humanharness/cli/tool"`, tools spec §3.1).
 * No Node imports: it is bundled into the tool's sandbox.
 */
export { defineTool, z, type ToolContext, type ToolDefinition } from "@humanharness/harness-sdk/tool";
