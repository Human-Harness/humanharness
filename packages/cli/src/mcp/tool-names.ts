/**
 * The tools `humanharness mcp` registers, per mode, in the order an agent lists them. No imports: the shell's manual
 * test reads `TOOL_NAMES` to check that the home folder's AGENTS.md names each one, so it stays the app mode's list;
 * the harness mode's are named by the /new-harness guide (guide.test.ts checks it).
 */
export const TOOL_NAMES = ["status", "catalog", "mod_new", "mod_check", "mod_clone", "layout_clone", "shot"] as const;
/** App mode: the app's home folder. */
export const APP_TOOLS = TOOL_NAMES;
/** Harness mode: a harness project. `status` and `shot` need the running app, so they aren't here. */
export const HARNESS_TOOLS = ["catalog", "mod_new", "mod_check", "mod_clone", "layout_clone", "harness_init", "harness_check"] as const;
export type ToolName = (typeof TOOL_NAMES)[number] | (typeof HARNESS_TOOLS)[number];
