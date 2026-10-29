import path from "node:path";
import { type JobStep, TOOLS_MAX, type ToolsJson, type ToolsManifest, recipeSourceProblems, stepProblems, toolProblems, toolsJsonSchema } from "@humanharness/harness-sdk";
import { readNoLinks } from "@humanharness/workspace";

/**
 * `<harness root>/dist/tools.json` as the app reads it at start (tools spec §3.2, Decision 3): at most 1 MB, never
 * through a link, its shape checked and then every rule of §3.3 the build can't see (`toolProblems`, `stepProblems`, then
 * the job recipes' `recipeSourceProblems`),
 * so a stale or hand-edited file never runs. Any failure turns tools off: every call answers the reason, and main logs why once.
 * `toolProblems` also ties each entry's `file` to its id (`tools/<id>.js`): the host only ever loads a tool's bundle
 * by its id, and a tools.json pointing one id at another tool's bundle is refused here.
 */

export const TOOLS_JSON_MAX_BYTES = 1024 * 1024;
export const NOT_BUILT = "Tools are not built: run humanharness build";

export type ToolsState = { on: true; tools: ToolsJson["tools"] } | { on: false; reason: string };

/** A line for the log or a caller: one line, at most 300 characters. */
const line = (text: string) => text.replace(/\s+/g, " ").slice(0, 300);

/** What main reads of the manifest: the tools' rules and, for job recipes (slice 4), each job's steps (other job keys pass through). */
export type ToolsJsonManifest = ToolsManifest & { jobs?: Record<string, { steps?: JobStep[]; permissions?: unknown }> };

export async function readToolsJson(root: string, manifest: ToolsJsonManifest, log: (message: string) => void): Promise<ToolsState> {
  const off = (why: string, reason = NOT_BUILT): ToolsState => {
    log(line(why));
    return { on: false, reason };
  };
  let text: string | null;
  try {
    text = await readNoLinks(root, path.join(root, "dist", "tools.json"), TOOLS_JSON_MAX_BYTES);
  } catch (err) {
    // A link, a non-file or a file over the cap: its message names the path under the root, never the disk path.
    return off(`Tools are off: dist/tools.json can't be read (${err instanceof Error ? err.message : String(err)})`);
  }
  if (text === null) return off("Tools are off: dist/tools.json is missing (run humanharness build)");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return off("Tools are off: dist/tools.json is not JSON");
  }
  const parsed = toolsJsonSchema.safeParse(raw);
  if (!parsed.success) {
    const i = parsed.error.issues[0];
    return off(`Tools are off: dist/tools.json: ${i ? `${i.path.join(".") || "(root)"}: ${i.message}` : "invalid"}`);
  }
  if (Object.keys(parsed.data.tools).length > TOOLS_MAX) return off(`Tools are off: dist/tools.json lists at most ${TOOLS_MAX} tools`);
  // Then the pre-steps and expects (`stepProblems`, slice 3) and the job recipes (slice 4) that need tools.json: none without them (D0).
  const problem = toolProblems(manifest, parsed.data)[0]?.message ?? stepProblems(manifest, parsed.data)[0] ?? recipeSourceProblems(manifest, parsed.data)[0];
  if (problem) {
    const reason = line(problem);
    return off(`Tools are off: ${reason}`, reason);
  }
  return { on: true, tools: parsed.data.tools };
}
