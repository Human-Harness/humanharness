/**
 * The tools `humanharness mcp` registers, in the order an agent lists them. No imports: the shell's manual test reads
 * it to check that the home folder's AGENTS.md names each one.
 */
export const TOOL_NAMES = ["status", "catalog", "mod_new", "mod_check", "mod_clone", "layout_clone", "shot"] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
